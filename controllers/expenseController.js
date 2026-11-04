import { Expense } from '../models/index.js';

import {
  addDays,
  fail,
  money,
  optionalText,
  parseDate,
  requiredText,
} from '../utils/helpers.js';

export async function getExpenses(req, res) {
  const filter = {};

  if (req.query.startDate || req.query.endDate) {
    filter.date = {};

    if (req.query.startDate) {
      filter.date.$gte = parseDate(req.query.startDate, 'startDate');
    }

    if (req.query.endDate) {
      filter.date.$lt = addDays(
        parseDate(req.query.endDate, 'endDate'),
        1
      );
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
    filter.category = requiredText(
      req.query.category,
      'Category',
      100
    );
  }

  const expenses = await Expense.find(filter).sort({
    date: -1,
    createdAt: -1,
  });

  res.json(expenses);
}

export async function createExpense(req, res) {
  const expense = await Expense.create({
    date: req.body.date
      ? parseDate(req.body.date, 'Expense date')
      : new Date(),

    category: requiredText(req.body.category, 'Category', 100),
    amount: money(req.body.amount, 'Expense amount'),
    description: optionalText(req.body.description),
  });

  res.status(201).json(expense);
}

export async function updateExpense(req, res) {
  const expense = await Expense.findById(req.params.id);

  if (!expense) fail('Expense not found', 404);

  if (req.body.date !== undefined) {
    expense.date = parseDate(req.body.date, 'Expense date');
  }

  if (req.body.category !== undefined) {
    expense.category = requiredText(req.body.category, 'Category', 100);
  }

  if (req.body.amount !== undefined) {
    expense.amount = money(req.body.amount, 'Expense amount');
  }

  if (req.body.description !== undefined) {
    expense.description = optionalText(req.body.description);
  }

  await expense.save();

  res.json(expense);
}

export async function deleteExpense(req, res) {
  const expense = await Expense.findByIdAndDelete(req.params.id);

  if (!expense) fail('Expense not found', 404);

  res.json({
    message: 'Expense deleted successfully',
    id: expense._id,
  });
}