import { randomUUID } from 'node:crypto';

import {
  Member,
  Payment,
} from '../models/index.js';

import { syncInvoices } from '../services/billingService.js';

import {
  currentMonth,
  escapeRegex,
  fail,
  fromCents,
  money,
  optionalText,
  paymentView,
  requiredText,
  sumMoney,
  toCents,
  validateMonth,
} from '../utils/helpers.js';

export async function getPayments(req, res) {
  await syncInvoices();

  const conditions = [];

  if (req.query.month) {
    conditions.push({
      billingMonth: validateMonth(req.query.month),
    });
  }

  if (req.query.memberId) {
    conditions.push({ memberId: req.query.memberId });
  }

  if (req.query.legacy !== undefined) {
    if (!['true', 'false'].includes(req.query.legacy)) {
      fail('legacy must be true or false');
    }

    conditions.push({ legacy: req.query.legacy === 'true' });
  }

  if (req.query.status) {
    const status = req.query.status;

    if (status === 'pending') {
      conditions.push({ remainingBalance: { $gt: 0 } });
    } else if (status === 'overdue') {
      conditions.push({
        remainingBalance: { $gt: 0 },
        dueDate: { $lt: new Date() },
      });
    } else if (['paid', 'partial', 'unpaid'].includes(status)) {
      conditions.push({ status });
    } else {
      fail('Invalid payment status');
    }
  }

  if (req.query.search) {
    const search = requiredText(req.query.search, 'Search', 100);
    const regex = new RegExp(escapeRegex(search), 'i');

    const members = await Member.find({
      $or: [
        { fullName: regex },
        { phone: regex },
        { memberId: regex },
      ],
    })
      .select('_id')
      .lean();

    conditions.push({
      $or: [
        { invoiceNumber: regex },
        { memberId: { $in: members.map((member) => member._id) } },
      ],
    });
  }

  const filter = conditions.length ? { $and: conditions } : {};

  const payments = await Payment.find(filter)
    .populate('memberId', 'fullName phone memberId')
    .populate('serviceId', 'name')
    .sort({ periodStart: -1, createdAt: -1 })
    .lean();

  res.json(payments.map(paymentView));
}

export async function getPayment(req, res) {
  const payment = await Payment.findById(req.params.id)
    .populate('memberId', 'fullName phone memberId address')
    .populate('serviceId', 'name');

  if (!payment) fail('Invoice not found', 404);

  res.json(paymentView(payment));
}

export async function recordPayment(req, res) {
  const { paymentId } = req.body;

  const amount = money(req.body.amountPaid, 'Payment amount');
  const method = req.body.method || 'cash';

  if (!['cash', 'bank', 'card', 'other'].includes(method)) {
    fail('Invalid payment method');
  }

  const reference = optionalText(req.body.reference, 200);
  const note = optionalText(req.body.note, 1000);

  // Frontend must reuse the same key when retrying the same payment.
  const idempotencyKey = requiredText(
    req.get('Idempotency-Key') || req.body.idempotencyKey,
    'Idempotency key',
    100
  );

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const payment = await Payment.findById(paymentId);

    if (!payment) fail('Invoice not found', 404);

    const previous = payment.transactions.find(
      (transaction) => transaction.idempotencyKey === idempotencyKey
    );

    if (previous) {
      if (
        toCents(previous.amount) !== toCents(amount) ||
        previous.method !== method ||
        previous.reference !== reference ||
        previous.note !== note
      ) {
        fail('This idempotency key was used for different payment details', 409);
      }

      return res.json({
        ...paymentView(payment),
        receipt: previous.toObject(),
        duplicateRequest: true,
      });
    }

    if (toCents(amount) > toCents(payment.remainingBalance)) {
      fail(
        `Payment exceeds the remaining balance of ${payment.remainingBalance}`
      );
    }

    const receipt = {
      receiptNumber: `REC-${randomUUID().toUpperCase()}`,
      idempotencyKey,

      amount,
      method,
      reference,
      note,

      receivedAt: new Date(),
    };

    payment.transactions.push(receipt);

    const paidCents =
      toCents(payment.amountPaid) + toCents(amount);

    const balanceCents =
      toCents(payment.amountCharged) - paidCents;

    payment.amountPaid = fromCents(paidCents);
    payment.remainingBalance = fromCents(balanceCents);

    payment.status = balanceCents === 0 ? 'paid' : 'partial';
    payment.paymentDate = receipt.receivedAt;

    try {
      // optimisticConcurrency prevents simultaneous updates
      // from overwriting each other's receipt and balance.
      await payment.save();

      return res.json({
        ...paymentView(payment),
        receipt:
          payment.transactions[payment.transactions.length - 1].toObject(),
        duplicateRequest: false,
      });
    } catch (error) {
      if (error.name !== 'VersionError') throw error;

      if (attempt === 4) {
        fail(
          'Another payment is being processed. Retry using the same idempotency key.',
          409
        );
      }
    }
  }
}

export async function getArrears(req, res) {
  await syncInvoices();

  const month = validateMonth(req.query.month || currentMonth());

  const invoices = await Payment.find({
    remainingBalance: { $gt: 0 },

    $or: [
      { billingMonth: { $lt: month } },

      // Legacy billing periods were free text and cannot be
      // safely assigned to a month without manual reconciliation.
      { legacy: true },
    ],
  })
    .populate('memberId', 'fullName phone memberId')
    .populate('serviceId', 'name')
    .sort({ billingMonth: 1, createdAt: 1 })
    .lean();

  const groups = new Map();

  for (const invoice of invoices) {
    const key = String(invoice.memberId?._id || invoice._id);

    if (!groups.has(key)) {
      groups.set(key, {
        member: invoice.memberId,
        invoices: [],
      });
    }

    groups.get(key).invoices.push(paymentView(invoice));
  }

  const members = [...groups.values()]
    .map((group) => ({
      ...group,

      totalDue: sumMoney(
        group.invoices,
        (invoice) => invoice.remainingBalance
      ),

      invoiceCount: group.invoices.length,

      hasLegacyBalance: group.invoices.some(
        (invoice) => invoice.legacy
      ),
    }))
    .sort((a, b) => b.totalDue - a.totalDue);

  res.json({
    month,

    totalMembers: members.length,
    totalDue: sumMoney(invoices, (invoice) => invoice.remainingBalance),

    legacyUnallocatedDue: sumMoney(
      invoices.filter((invoice) => invoice.legacy),
      (invoice) => invoice.remainingBalance
    ),

    members,
  });
}

export async function syncPaymentInvoices(req, res) {
  res.json(await syncInvoices());
}