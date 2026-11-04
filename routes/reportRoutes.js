import express from 'express';
import { getFinancialSummary } from '../controllers/reportController.js';

const router = express.Router();
router.get('/summary', getFinancialSummary);
export default router;