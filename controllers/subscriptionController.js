import mongoose from 'mongoose';

import {
  Member,
  Service,
  Subscription,
} from '../models/index.js';

import {
  issueInvoice,
  syncInvoices,
} from '../services/billingService.js';

import {
  currentMonth,
  fail,
  localDate,
  money,
  monthStart,
  parseDate,
} from '../utils/helpers.js';

export async function getSubscriptions(req, res) {
  await syncInvoices();

  const filter = {};

  if (req.query.memberId) {
    filter.memberId = req.query.memberId;
  }

  if (req.query.status) {
    if (!['active', 'expired', 'cancelled'].includes(req.query.status)) {
      fail('Invalid subscription status');
    }

    filter.status = req.query.status;
  }

  const subscriptions = await Subscription.find(filter)
    .populate('memberId', 'fullName phone memberId')
    .populate('serviceId', 'name fee')
    .sort({ createdAt: -1 });

  res.json(subscriptions);
}

export async function createSubscription(req, res) {
  const {
    memberId,
    serviceId,
    billingMethod = 'calendar-month',
  } = req.body;

  if (billingMethod !== 'calendar-month') {
    fail('This system uses calendar-month billing');
  }

const start = parseDate(
  req.body.startDate || localDate(),
  'Start date'
);

  // Historical balances belong in the migration, not a new subscription.
  if (start < monthStart(currentMonth())) {
    fail('New subscriptions cannot start before the current month');
  }

  const result = await mongoose.connection.transaction(
    async (session) => {
      const member = await Member.findById(memberId).session(session);
      const service = await Service.findById(serviceId).session(session);

      if (!member) fail('Member not found', 404);
      if (!service) fail('Service not found', 404);
      if (!service.isActive) fail('Service is inactive');

      const existing = await Subscription.findOne({
        memberId,
        serviceId,
        status: 'active',
      }).session(session);

      if (existing) {
        fail('Member already has an active subscription for this service', 409);
      }

      const fee =
        req.body.fee === undefined
          ? service.fee
          : money(req.body.fee, 'Subscription fee');

      const [subscription] = await Subscription.create(
        [
          {
            memberId,
            serviceId,
            fee,

            billingMethod: 'calendar-month',
            startDate: start,

            nextBillingDate: start,
            dueDate: start,

            status: 'active',
            billingVersion: 2,
          },
        ],
        { session }
      );

      let invoice = null;

      if (start <= new Date()) {
        invoice = await issueInvoice(subscription, session);
      }

      return {
        subscription: subscription.toObject(),
        invoice: invoice?.toObject() || null,
      };
    }
  );

  res.status(201).json(result);
}

export async function cancelSubscription(req, res) {
  // Generate any already-started periods before cancellation.
  await syncInvoices();

  const subscription = await Subscription.findById(req.params.id);

  if (!subscription) fail('Subscription not found', 404);

  if (subscription.status === 'cancelled') {
    return res.json(subscription);
  }

  subscription.status = 'cancelled';
  subscription.cancelledAt = new Date();

  await subscription.save();

  res.json(subscription);
}