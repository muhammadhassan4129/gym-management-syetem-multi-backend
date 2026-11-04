import express from 'express';
import { getMembers, createMember, updateMember } from '../controllers/memberController.js';

const router = express.Router();

router.get('/', getMembers);
router.post('/', createMember);
router.put('/:id', updateMember);

export default router;