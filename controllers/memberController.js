import { randomUUID } from 'node:crypto';

import {
  Member,
  Payment,
  Subscription,
} from '../models/index.js';

import { syncInvoices } from '../services/billingService.js';

import {
  escapeRegex,
  fail,
  optionalText,
  parseDate,
  paymentView,
  requiredText,
  sumMoney,
} from '../utils/helpers.js';

export async function getMembers(req, res) {
  const filter = {};

  if (req.query.search) {
    const search = requiredText(req.query.search, 'Search', 100);
    const regex = new RegExp(escapeRegex(search), 'i');

    filter.$or = [
      { fullName: regex },
      { phone: regex },
      { memberId: regex },
    ];
  }

  const members = await Member.find(filter).sort({ createdAt: -1 });

  res.json(members);
}

export async function createMember(req, res) {
  const member = await Member.create({
    // Existing member IDs are preserved during migration.
    // New IDs avoid the old "find last + 1" race condition.
    memberId: `GYM-${randomUUID().toUpperCase()}`,

    fullName: requiredText(req.body.fullName, 'Full name', 120),
    phone: requiredText(req.body.phone, 'Phone', 30),

    address: optionalText(req.body.address, 500),
    notes: optionalText(req.body.notes),

    registrationDate: req.body.registrationDate
      ? parseDate(req.body.registrationDate, 'Registration date')
      : new Date(),
  });

  res.status(201).json(member);
}

export async function updateMember(req, res) {
  const member = await Member.findById(req.params.id);

  if (!member) fail('Member not found', 404);

  if (req.body.fullName !== undefined) {
    member.fullName = requiredText(req.body.fullName, 'Full name', 120);
  }

  if (req.body.phone !== undefined) {
    member.phone = requiredText(req.body.phone, 'Phone', 30);
  }

  if (req.body.address !== undefined) {
    member.address = optionalText(req.body.address, 500);
  }

  if (req.body.notes !== undefined) {
    member.notes = optionalText(req.body.notes);
  }

  if (req.body.registrationDate !== undefined) {
    member.registrationDate = parseDate(
      req.body.registrationDate,
      'Registration date'
    );
  }

  await member.save();

  res.json(member);
}

export async function getMemberLedger(req, res) {
  await syncInvoices();

  const member = await Member.findById(req.params.id).lean();

  if (!member) fail('Member not found', 404);

  const [payments, subscriptions] = await Promise.all([
    Payment.find({ memberId: member._id })
      .populate('serviceId', 'name')
      .sort({ periodStart: -1, createdAt: -1 })
      .lean(),

    Subscription.find({ memberId: member._id })
      .populate('serviceId', 'name fee')
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  res.json({
    member,
    subscriptions,

    totals: {
      amountCharged: sumMoney(payments, (row) => row.amountCharged),
      amountPaid: sumMoney(payments, (row) => row.amountPaid),
      remainingBalance: sumMoney(
        payments,
        (row) => row.remainingBalance
      ),
    },

    invoices: payments.map(paymentView),
  });
}