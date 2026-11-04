import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';

import {
  Member,
  Service,
  Subscription,
  Payment,
  Expense,
} from '../models/index.js';

import {
  issueInvoice,
  syncInvoices,
} from '../services/billingService.js';

import {
  addDays,
  currentMonth,
  escapeRegex,
  fail,
  fromCents,
  localDate,
  money,
  monthStart,
  optionalText,
  parseDate,
  paymentView,
  requiredText,
  sumMoney,
  toCents,
  validateMonth,
} from '../utils/helpers.js';

import {
  bodyFields,
  booleanValue,
  objectId,
  populateMember,
  populateService,
} from '../utils/validation.js';

const scope = (req) => ({ gymId: req.gym._id });

const recordFilter = (req) => ({
  ...scope(req),
  _id: objectId(req.params.id),
});

// ─── Services ──────────────────────────────────

export async function getServices(req, res) {
  const filter = scope(req);

  if (req.query.active !== undefined) {
    if (!['true', 'false'].includes(req.query.active)) {
      fail('active must be true or false');
    }

    filter.isActive = req.query.active === 'true';
  }

  res.json(await Service.find(filter).sort({ name: 1 }));
}

export async function createService(req, res) {
  const body = bodyFields(req, ['name', 'fee', 'description']);

  res.status(201).json(await Service.create({
    ...scope(req),
    name: requiredText(body.name, 'Service name', 120),
    fee: money(body.fee, 'Service fee'),
    description: optionalText(body.description),
    isActive: true,
  }));
}

export async function updateService(req, res) {
  const body = bodyFields(req, [
    'name', 'fee', 'description', 'isActive',
  ]);

  const service = await Service.findOne(recordFilter(req));

  if (!service) fail('Service not found', 404);

  if (body.name !== undefined) {
    service.name = requiredText(body.name, 'Service name', 120);
  }

  if (body.fee !== undefined) {
    service.fee = money(body.fee, 'Service fee');
  }

  if (body.description !== undefined) {
    service.description = optionalText(body.description);
  }

  if (body.isActive !== undefined) {
    service.isActive = booleanValue(body.isActive, 'isActive');
  }

  await service.save();
  res.json(service);
}

// ─── Members ───────────────────────────────────

export async function getMembers(req, res) {
  const filter = scope(req);

  if (req.query.search) {
    const regex = new RegExp(
      escapeRegex(requiredText(req.query.search, 'Search', 100)),
      'i'
    );

    filter.$or = [
      { fullName: regex },
      { phone: regex },
      { memberId: regex },
    ];
  }

  res.json(await Member.find(filter).sort({ createdAt: -1 }));
}

export async function createMember(req, res) {
  const body = bodyFields(req, [
    'fullName', 'phone', 'address', 'registrationDate', 'notes',
  ]);

  res.status(201).json(await Member.create({
    ...scope(req),
    memberId: `GYM-${randomUUID().toUpperCase()}`,
    fullName: requiredText(body.fullName, 'Full name', 120),
    phone: requiredText(body.phone, 'Phone', 30),
    address: optionalText(body.address, 500),
    notes: optionalText(body.notes),
    registrationDate: body.registrationDate
      ? parseDate(body.registrationDate, 'Registration date')
      : new Date(),
  }));
}

export async function updateMember(req, res) {
  const body = bodyFields(req, [
    'fullName', 'phone', 'address', 'registrationDate', 'notes',
  ]);

  const member = await Member.findOne(recordFilter(req));

  if (!member) fail('Member not found', 404);

  if (body.fullName !== undefined) {
    member.fullName = requiredText(body.fullName, 'Full name', 120);
  }

  if (body.phone !== undefined) {
    member.phone = requiredText(body.phone, 'Phone', 30);
  }

  if (body.address !== undefined) {
    member.address = optionalText(body.address, 500);
  }

  if (body.notes !== undefined) {
    member.notes = optionalText(body.notes);
  }

  if (body.registrationDate !== undefined) {
    member.registrationDate = parseDate(body.registrationDate);
  }

  await member.save();
  res.json(member);
}

export async function getMemberLedger(req, res) {
  const member = await Member.findOne(recordFilter(req)).lean();

  if (!member) fail('Member not found', 404);

  const billingSync = await syncInvoices(req.gym._id);

  const filter = {
    ...scope(req),
    memberId: member._id,
  };

  const [payments, subscriptions] = await Promise.all([
    Payment.find(filter)
      .populate(populateService(req.gym._id))
      .sort({ periodStart: -1, createdAt: -1 })
      .lean(),

    Subscription.find(filter)
      .populate(populateService(req.gym._id))
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  res.json({
    member,
    subscriptions,
    billingSync,
    totals: {
      amountCharged: sumMoney(payments, (row) => row.amountCharged),
      amountPaid: sumMoney(payments, (row) => row.amountPaid),
      remainingBalance: sumMoney(payments, (row) => row.remainingBalance),
    },
    invoices: payments.map(paymentView),
  });
}

// ─── Subscriptions ─────────────────────────────

export async function getSubscriptions(req, res) {
  const billingSync = await syncInvoices(req.gym._id);
  const filter = scope(req);

  if (req.query.memberId) {
    filter.memberId = objectId(req.query.memberId, 'member');
  }

  if (req.query.status) {
    if (!['active', 'expired', 'cancelled'].includes(req.query.status)) {
      fail('Invalid subscription status');
    }

    filter.status = req.query.status;
  }

  res.set('X-Billing-Has-More', String(billingSync.hasMore));

  res.json(await Subscription.find(filter)
    .populate(populateMember(req.gym._id))
    .populate(populateService(req.gym._id))
    .sort({ createdAt: -1 }));
}

export async function createSubscription(req, res) {
  const body = bodyFields(req, [
    'memberId', 'serviceId', 'fee', 'billingMethod', 'startDate',
  ]);

  if (
    body.billingMethod !== undefined &&
    body.billingMethod !== 'calendar-month'
  ) {
    fail('Only calendar-month billing is supported');
  }

  const gymId = req.gym._id;
  const memberId = objectId(body.memberId, 'member');
  const serviceId = objectId(body.serviceId, 'service');

  const start = parseDate(body.startDate || localDate(), 'Start date');

  if (start < monthStart(currentMonth())) {
    fail('Start date cannot be before the current month');
  }

  const result = await mongoose.connection.transaction(async (session) => {
    const member = await Member.findOne({ _id: memberId, gymId })
      .session(session);

    const service = await Service.findOne({ _id: serviceId, gymId })
      .session(session);

    if (!member) fail('Member not found', 404);
    if (!service) fail('Service not found', 404);
    if (!service.isActive) fail('Service is inactive');

    const existing = await Subscription.findOne({
      gymId,
      memberId,
      serviceId,
      status: 'active',
    }).session(session);

    if (existing) fail('An active subscription already exists', 409);

    const [subscription] = await Subscription.create(
      [{
        gymId,
        memberId,
        serviceId,
        fee: body.fee === undefined
          ? service.fee
          : money(body.fee, 'Subscription fee'),
        billingMethod: 'calendar-month',
        startDate: start,
        nextBillingDate: start,
        dueDate: start,
        status: 'active',
        billingVersion: 2,
      }],
      { session }
    );

    const invoice = start <= new Date()
      ? await issueInvoice(subscription, session)
      : null;

    return { subscription, invoice };
  });

  res.status(201).json(result);
}

export async function cancelSubscription(req, res) {
  const filter = recordFilter(req);
  const asOf = new Date();

  const subscription = await mongoose.connection.transaction(
    async (session) => {
      const item = await Subscription.findOne(filter).session(session);

      if (!item) fail('Subscription not found', 404);
      if (item.status === 'cancelled') return item;

      let count = 0;

      while (
        item.status === 'active' &&
        item.nextBillingDate <= asOf
      ) {
        if (++count > 120) {
          fail('Large billing backlog: sync this gym before cancelling', 409);
        }

        await issueInvoice(item, session);
      }

      item.status = 'cancelled';
      item.cancelledAt = asOf;

      await item.save({ session });
      return item;
    }
  );

  res.json(subscription);
}

// ─── Payments ──────────────────────────────────

export async function getPayments(req, res) {
  const billingSync = await syncInvoices(req.gym._id);
  const filter = scope(req);

  if (req.query.month) {
    filter.billingMonth = validateMonth(req.query.month);
  }

  if (req.query.memberId) {
    filter.memberId = objectId(req.query.memberId, 'member');
  }

  if (req.query.legacy !== undefined) {
    if (!['true', 'false'].includes(req.query.legacy)) {
      fail('legacy must be true or false');
    }

    filter.legacy = req.query.legacy === 'true';
  }

  if (req.query.status) {
    const status = req.query.status;

    if (status === 'pending') {
      filter.remainingBalance = { $gt: 0 };
    } else if (status === 'overdue') {
      filter.remainingBalance = { $gt: 0 };
      filter.dueDate = { $lt: new Date() };
    } else if (['paid', 'partial', 'unpaid'].includes(status)) {
      filter.status = status;
    } else {
      fail('Invalid payment status');
    }
  }

  if (req.query.search) {
    const regex = new RegExp(
      escapeRegex(requiredText(req.query.search, 'Search', 100)),
      'i'
    );

    const members = await Member.find({
      ...scope(req),
      $or: [
        { fullName: regex },
        { phone: regex },
        { memberId: regex },
      ],
    }).select('_id').lean();

    filter.$or = [
      { invoiceNumber: regex },
      { memberId: { $in: members.map((member) => member._id) } },
    ];
  }

  const rows = await Payment.find(filter)
    .populate(populateMember(req.gym._id))
    .populate(populateService(req.gym._id))
    .sort({ periodStart: -1, createdAt: -1 })
    .lean();

  res.set('X-Billing-Has-More', String(billingSync.hasMore));
  res.json(rows.map(paymentView));
}

export async function getPayment(req, res) {
  const payment = await Payment.findOne(recordFilter(req))
    .populate(populateMember(req.gym._id))
    .populate(populateService(req.gym._id));

  if (!payment) fail('Invoice not found', 404);

  res.json(paymentView(payment));
}

export async function recordPayment(req, res) {
  const body = bodyFields(req, [
    'paymentId', 'amountPaid', 'method',
    'reference', 'note', 'idempotencyKey',
  ]);

  const paymentId = objectId(body.paymentId, 'invoice');
  const amount = money(body.amountPaid, 'Payment amount');
  const method = body.method || 'cash';

  if (!['cash', 'bank', 'card', 'other'].includes(method)) {
    fail('Invalid payment method');
  }

  const reference = optionalText(body.reference, 200);
  const note = optionalText(body.note, 1000);

  const idempotencyKey = requiredText(
    req.get('Idempotency-Key') || body.idempotencyKey,
    'Idempotency key',
    100
  );

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const payment = await Payment.findOne({
      ...scope(req),
      _id: paymentId,
    });

    if (!payment) fail('Invoice not found', 404);

    const previous = payment.transactions.find(
      (row) => row.idempotencyKey === idempotencyKey
    );

    if (previous) {
      if (
        toCents(previous.amount) !== toCents(amount) ||
        previous.method !== method ||
        previous.reference !== reference ||
        previous.note !== note
      ) {
        fail('Idempotency key was used with different payment details', 409);
      }

      return res.json({
        ...paymentView(payment),
        receipt: previous.toObject(),
        duplicateRequest: true,
      });
    }

    if (toCents(amount) > toCents(payment.remainingBalance)) {
      fail('Payment exceeds the remaining balance');
    }

    payment.transactions.push({
      receiptNumber: `REC-${randomUUID().toUpperCase()}`,
      idempotencyKey,
      amount,
      method,
      reference,
      note,
      receivedAt: new Date(),
      receivedBy: req.user._id,
    });

    const paid = toCents(payment.amountPaid) + toCents(amount);
    const balance = toCents(payment.amountCharged) - paid;

    payment.amountPaid = fromCents(paid);
    payment.remainingBalance = fromCents(balance);
    payment.status = balance === 0 ? 'paid' : 'partial';
    payment.paymentDate = new Date();

    try {
      await payment.save();

      return res.json({
        ...paymentView(payment),
        receipt: payment.transactions.at(-1).toObject(),
        duplicateRequest: false,
      });
    } catch (error) {
      if (error.name !== 'VersionError') throw error;

      if (attempt === 4) {
        fail('Concurrent payment detected. Retry with the same key.', 409);
      }
    }
  }
}

export async function getArrears(req, res) {
  const billingSync = await syncInvoices(req.gym._id);
  const month = validateMonth(req.query.month || currentMonth());

  const invoices = await Payment.find({
    ...scope(req),
    remainingBalance: { $gt: 0 },
    $or: [
      { billingMonth: { $lt: month } },
      { legacy: true },
    ],
  })
    .populate(populateMember(req.gym._id))
    .populate(populateService(req.gym._id))
    .sort({ billingMonth: 1, createdAt: 1 })
    .lean();

  const groups = new Map();

  for (const invoice of invoices) {
    const key = String(invoice.memberId?._id || invoice._id);

    if (!groups.has(key)) {
      groups.set(key, { member: invoice.memberId, invoices: [] });
    }

    groups.get(key).invoices.push(paymentView(invoice));
  }

  const members = [...groups.values()].map((group) => ({
    ...group,
    invoiceCount: group.invoices.length,
    totalDue: sumMoney(group.invoices, (row) => row.remainingBalance),
    hasLegacyBalance: group.invoices.some((row) => row.legacy),
  })).sort((a, b) => b.totalDue - a.totalDue);

  res.json({
    month,
    billingSync,
    totalMembers: members.length,
    totalDue: sumMoney(invoices, (row) => row.remainingBalance),
    legacyUnallocatedDue: sumMoney(
      invoices.filter((row) => row.legacy),
      (row) => row.remainingBalance
    ),
    members,
  });
}

export async function syncPaymentInvoices(req, res) {
  res.json(await syncInvoices(req.gym._id));
}

// ─── Expenses ──────────────────────────────────

export async function getExpenses(req, res) {
  const filter = scope(req);

  if (req.query.startDate || req.query.endDate) {
    filter.date = {};

    if (req.query.startDate) {
      filter.date.$gte = parseDate(req.query.startDate);
    }

    if (req.query.endDate) {
      filter.date.$lt = addDays(parseDate(req.query.endDate), 1);
    }

    if (
      filter.date.$gte &&
      filter.date.$lt &&
      filter.date.$gte >= filter.date.$lt
    ) {
      fail('Invalid date range');
    }
  }

  if (req.query.category) {
    filter.category = requiredText(req.query.category, 'Category', 100);
  }

  res.json(await Expense.find(filter).sort({ date: -1, createdAt: -1 }));
}

export async function createExpense(req, res) {
  const body = bodyFields(req, ['date', 'category', 'amount', 'description']);

  res.status(201).json(await Expense.create({
    ...scope(req),
    date: body.date ? parseDate(body.date) : new Date(),
    category: requiredText(body.category, 'Category', 100),
    amount: money(body.amount, 'Expense amount'),
    description: optionalText(body.description),
  }));
}

export async function updateExpense(req, res) {
  const body = bodyFields(req, ['date', 'category', 'amount', 'description']);
  const expense = await Expense.findOne(recordFilter(req));

  if (!expense) fail('Expense not found', 404);

  if (body.date !== undefined) expense.date = parseDate(body.date);

  if (body.category !== undefined) {
    expense.category = requiredText(body.category, 'Category', 100);
  }

  if (body.amount !== undefined) {
    expense.amount = money(body.amount, 'Expense amount');
  }

  if (body.description !== undefined) {
    expense.description = optionalText(body.description);
  }

  await expense.save();
  res.json(expense);
}

export async function deleteExpense(req, res) {
  const expense = await Expense.findOneAndDelete(recordFilter(req));

  if (!expense) fail('Expense not found', 404);

  res.json({
    message: 'Expense deleted successfully',
    id: expense._id,
  });
}