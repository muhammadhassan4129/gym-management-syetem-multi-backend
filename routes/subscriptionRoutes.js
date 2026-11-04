import express from 'express';
import { getSubscriptions, createSubscription } from '../controllers/subscriptionController.js';

const router = express.Router();

router.get('/', getSubscriptions);
router.post('/', createSubscription);

export default router;