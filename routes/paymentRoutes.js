import express from 'express';
import { getPayments, recordPayment } from '../controllers/paymentController.js';

const router = express.Router();

router.get('/', getPayments);
router.post('/pay', recordPayment);

export default router;