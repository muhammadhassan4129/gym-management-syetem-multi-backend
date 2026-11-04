import express from 'express';

import { asyncHandler as wrap } from '../utils/helpers.js';

import {
  verifyToken,
  requireGym,
  roles,
} from '../middleware/authMiddleware.js';

import * as gym from '../controllers/gymController.js';
import * as platform from '../controllers/platformController.js';

import {
  getFinancialSummary,
  downloadFinancialPdf,
} from '../controllers/reportController.js';

const router = express.Router();

const manager = roles('owner', 'manager');
const owner = roles('owner');

router.use(verifyToken);

// Owner can view software bills even after software access expires.
router.get(
  '/gym/billing',
  requireGym({ allowExpired: true }),
  owner,
  wrap(platform.ownBilling)
);

// All remaining routes require an operational gym.
router.use(requireGym());

router.get('/gym', (req, res) => {
  res.json({
    gym: req.gym,
    role: req.membership.role,
  });
});

router.patch('/gym', owner, wrap(platform.updateOwnGym));

router.get('/staff', owner, wrap(platform.listStaff));
router.post('/staff', owner, wrap(platform.createStaff));
router.patch('/staff/:id', owner, wrap(platform.updateStaff));

router.get('/services', wrap(gym.getServices));
router.post('/services', manager, wrap(gym.createService));
router.put('/services/:id', manager, wrap(gym.updateService));

router.get('/members', wrap(gym.getMembers));
router.post('/members', wrap(gym.createMember));
router.put('/members/:id', wrap(gym.updateMember));
router.get('/members/:id/ledger', wrap(gym.getMemberLedger));

router.get('/subscriptions', wrap(gym.getSubscriptions));
router.post('/subscriptions', manager, wrap(gym.createSubscription));
router.patch('/subscriptions/:id/cancel', manager, wrap(gym.cancelSubscription));

router.get('/payments', wrap(gym.getPayments));
router.get('/payments/arrears', wrap(gym.getArrears));
router.post('/payments/sync', manager, wrap(gym.syncPaymentInvoices));
router.post('/payments/pay', wrap(gym.recordPayment));
router.get('/payments/:id', wrap(gym.getPayment));

router.get('/expenses', manager, wrap(gym.getExpenses));
router.post('/expenses', manager, wrap(gym.createExpense));
router.put('/expenses/:id', manager, wrap(gym.updateExpense));
router.delete('/expenses/:id', owner, wrap(gym.deleteExpense));

router.get('/reports/summary', manager, wrap(getFinancialSummary));
router.get('/reports/pdf', manager, wrap(downloadFinancialPdf));

export default router;