import {
  Expense,
  Member,
  Payment,
  Subscription,
} from '../models/index.js';

import { syncInvoices } from './billingService.js';

import {
  currentMonth,
  dateRange,
  fromCents,
  paymentView,
  sumMoney,
  toCents,
} from '../utils/helpers.js';

import {
  populateMember,
  populateService,
} from '../utils/validation.js';

export async function buildFinancialReport(gym, query) {
  if (!gym?._id) throw new Error('Report gym is required');

  const gymId = gym._id;
  const billingSync = await syncInvoices(gymId);
  const range = dateRange(query);

  const dateFilter = {
    $gte: range.start,
    $lt: range.endExclusive,
  };

  const [
    receiptInvoices,
    billedInvoices,
    expenses,
    outstandingInvoices,
    legacyTotals,
    totalMembers,
    activeSubscriptions,
  ] = await Promise.all([
    Payment.find({
      gymId,
      transactions: { $elemMatch: { receivedAt: dateFilter } },
    })
      .populate(populateMember(gymId))
      .lean(),

    Payment.find({
      gymId,
      periodStart: dateFilter,
      legacy: false,
    }).lean(),

    Expense.find({ gymId, date: dateFilter })
      .sort({ date: 1 })
      .lean(),

    Payment.find({
      gymId,
      remainingBalance: { $gt: 0 },
    })
      .populate(populateMember(gymId))
      .populate(populateService(gymId))
      .sort({ billingMonth: 1, createdAt: 1 })
      .lean(),

    Payment.aggregate([
      { $match: { gymId } },
      {
        $group: {
          _id: null,
          historicalReceivedWithoutDates: {
            $sum: '$legacyPaidAmount',
          },
        },
      },
    ]),

    Member.countDocuments({ gymId }),

    Subscription.countDocuments({
      gymId,
      status: 'active',
      startDate: { $lte: new Date() },
    }),
  ]);

  const receipts = [];

  for (const invoice of receiptInvoices) {
    for (const transaction of invoice.transactions || []) {
      const date = new Date(transaction.receivedAt);

      if (date >= range.start && date < range.endExclusive) {
        receipts.push({
          ...transaction,
          invoiceId: invoice._id,
          invoiceNumber: invoice.invoiceNumber,
          billingMonth: invoice.billingMonth || null,
          member: invoice.memberId,
        });
      }
    }
  }

  receipts.sort((a, b) => new Date(a.receivedAt) - new Date(b.receivedAt));

  const totalIncome = sumMoney(receipts, (row) => row.amount);
  const totalExpenses = sumMoney(expenses, (row) => row.amount);

  const monthlyMap = new Map();

  function monthRow(month) {
    if (!monthlyMap.has(month)) {
      monthlyMap.set(month, { month, income: 0, expenses: 0 });
    }

    return monthlyMap.get(month);
  }

  for (const receipt of receipts) {
    monthRow(currentMonth(receipt.receivedAt)).income += toCents(receipt.amount);
  }

  for (const expense of expenses) {
    monthRow(currentMonth(expense.date)).expenses += toCents(expense.amount);
  }

  const monthly = [...monthlyMap.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((row) => ({
      month: row.month,
      income: fromCents(row.income),
      expenses: fromCents(row.expenses),
      netProfit: fromCents(row.income - row.expenses),
    }));

  function groupAmounts(rows, field) {
    const grouped = new Map();

    for (const row of rows) {
      grouped.set(
        row[field],
        (grouped.get(row[field]) || 0) + toCents(row.amount)
      );
    }

    return [...grouped.entries()]
      .map(([key, value]) => ({
        [field]: key,
        amount: fromCents(value),
      }))
      .sort((a, b) => b.amount - a.amount);
  }

  const previous = outstandingInvoices.filter(
    (row) => !row.legacy && row.billingMonth < currentMonth()
  );

  const legacy = outstandingInvoices.filter((row) => row.legacy);

  const historicalReceivedWithoutDates =
    legacyTotals[0]?.historicalReceivedWithoutDates || 0;

  const notes = [
    'Income uses actual receipt dates.',
    'Expenses use expense dates.',
    'Net cash is income received minus recorded expenses.',
    'Outstanding balances and member counts are current snapshots.',
    'Software subscription payments are not included in gym finances.',
    'Legacy receipts without dates are excluded from date-filtered income.',
  ];

  if (billingSync.hasMore) {
    notes.push('Billing catch-up is incomplete. Refresh or sync again.');
  }

  return {
    gymName: gym.name,
    currency: gym.currency,
    generatedAt: new Date(),
    billingSync,

    period: {
      startDate: range.startDate,
      endDate: range.endDate,
    },

    totalIncome,
    totalExpenses,
    netProfit: fromCents(toCents(totalIncome) - toCents(totalExpenses)),

    paymentsCount: receipts.length,
    expensesCount: expenses.length,

    totalBilled: sumMoney(billedInvoices, (row) => row.amountCharged),
    invoicesCount: billedInvoices.length,

    invoiceStatusCounts: {
      paid: billedInvoices.filter((row) => row.status === 'paid').length,
      partial: billedInvoices.filter((row) => row.status === 'partial').length,
      unpaid: billedInvoices.filter((row) => row.status === 'unpaid').length,
    },

    current: {
      asOf: new Date(),
      totalMembers,
      activeSubscriptions,
      outstandingBalance: sumMoney(outstandingInvoices, (row) => row.remainingBalance),
      previousMonthsDue: sumMoney(previous, (row) => row.remainingBalance),
      legacyUnallocatedDue: sumMoney(legacy, (row) => row.remainingBalance),
      outstandingInvoicesCount: outstandingInvoices.length,
    },

    historicalReceivedWithoutDates,
    monthly,
    expensesByCategory: groupAmounts(expenses, 'category'),
    incomeByMethod: groupAmounts(receipts, 'method'),
    receipts,
    expenses,
    outstandingInvoices: outstandingInvoices.map(paymentView),
    notes,
  };
}