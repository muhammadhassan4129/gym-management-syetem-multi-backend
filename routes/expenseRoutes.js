import express from 'express';
import { getExpenses, createExpense } from '../controllers/expenseController.js';

const router = express.Router();
router.get('/', getExpenses);
router.post('/', createExpense);
export default router;