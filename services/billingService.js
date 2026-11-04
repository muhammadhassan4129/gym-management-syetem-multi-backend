import mongoose from 'mongoose';

import {
  Member,
  Payment,
  Service,
  Subscription,
} from '../models/index.js';

import {
  addDays,
  currentMonth,
  fail,
  localDate,
  monthStart,
  nextMonth,
} from '../utils/helpers.js';

export async function issueInvoice(subscription, session) {
  if (!subscription.gymId) fail('Missing invoice gym', 500);

  const gymId = subscription.gymId;
  const start = new Date(subscription.nextBillingDate);
  const billingMonth = currentMonth(start);
  const end = monthStart(nextMonth(billingMonth));

  let invoice = await Payment.findOne({
    gymId,
    subscriptionId: subscription._id,
    billingMonth,
  }).session(session);

  if (!invoice) {
    const member = await Member.findOne({
      _id: subscription.memberId,
      gymId,
    }).session(session);

    const service = await Service.findOne({
      _id: subscription.serviceId,
      gymId,
    }).session(session);

    if (!member || !service) {
      fail('Subscription contains invalid gym references', 409);
    }

    const grace = Number(process.env.PAYMENT_GRACE_DAYS ?? 7);

    const [created] = await Payment.create(
      [{
        gymId,
        invoiceNumber:
          `INV-${billingMonth.replace('-', '')}-` +
          subscription._id.toString().toUpperCase(),

        memberId: subscription.memberId,
        serviceId: subscription.serviceId,
        subscriptionId: subscription._id,
        serviceName: service.name,

        billingMonth,
        billingPeriod:
          `${localDate(start)} to ${localDate(addDays(end, -1))}`,

        periodStart: start,
        periodEnd: end,
        dueDate: addDays(start, grace),

        amountCharged: subscription.fee,
        amountPaid: 0,
        remainingBalance: subscription.fee,

        status: subscription.fee === 0 ? 'paid' : 'unpaid',
        billingVersion: 2,
      }],
      { session }
    );

    invoice = created;
  }

  subscription.nextBillingDate = end;
  subscription.dueDate = end;

  await subscription.save({ session });

  return invoice;
}

const running = new Map();

export function syncInvoices(gymId) {
  if (!gymId) fail('Gym is required for billing sync', 500);

  const key = String(gymId);

  if (running.has(key)) return running.get(key);

  const promise = (async () => {
    const asOf = new Date();
    let processedPeriods = 0;

    // Bounded per request so a large backlog does not run indefinitely.
    const batchLimit = 100;

    while (processedPeriods < batchLimit) {
      const processed = await mongoose.connection.transaction(
        async (session) => {
          const subscription = await Subscription.findOne({
            gymId,
            status: 'active',
            billingVersion: 2,
            nextBillingDate: { $lte: asOf },
          })
            .sort({ nextBillingDate: 1, _id: 1 })
            .session(session);

          if (!subscription) return false;

          await issueInvoice(subscription, session);
          return true;
        }
      );

      if (!processed) break;
      processedPeriods += 1;
    }

    const remaining = await Subscription.exists({
      gymId,
      status: 'active',
      billingVersion: 2,
      nextBillingDate: { $lte: asOf },
    });

    return {
      checkedAt: asOf,
      processedPeriods,
      hasMore: Boolean(remaining),
    };
  })().finally(() => {
    running.delete(key);
  });

  running.set(key, promise);
  return promise;
}