import express from 'express';

import { asyncHandler } from '../utils/helpers.js';
import { verifyToken } from '../middleware/authMiddleware.js';

import {
  loginAdmin,
  getMe,
  selectGym,
  changePassword,
  logout,
} from '../controllers/authController.js';

const router = express.Router();

router.post('/login', asyncHandler(loginAdmin));

router.use(verifyToken);

router.get('/me', asyncHandler(getMe));
router.post('/select-gym', asyncHandler(selectGym));
router.post('/change-password', asyncHandler(changePassword));
router.post('/logout', asyncHandler(logout));

export default router;