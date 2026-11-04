import express from 'express';

import { asyncHandler as wrap } from '../utils/helpers.js';

import {
  verifyToken,
  requireSuperAdmin,
} from '../middleware/authMiddleware.js';

import * as controller from '../controllers/platformController.js';

const router = express.Router();

router.use(verifyToken, requireSuperAdmin);

router.get('/plans', wrap(controller.listPlans));
router.post('/plans', wrap(controller.createPlan));
router.patch('/plans/:id', wrap(controller.updatePlan));

router.get('/gyms', wrap(controller.listGyms));
router.post('/gyms', wrap(controller.createGym));
router.patch('/gyms/:id/status', wrap(controller.updateGymStatus));

router.get('/invoices', wrap(controller.listPlatformInvoices));
router.post('/gyms/:id/invoices', wrap(controller.issuePlatformInvoice));
router.post('/invoices/:id/pay', wrap(controller.payPlatformInvoice));
router.post('/invoices/:id/void', wrap(controller.voidPlatformInvoice));

router.post('/users/:id/reset-password', wrap(controller.resetUserPassword));

export default router;