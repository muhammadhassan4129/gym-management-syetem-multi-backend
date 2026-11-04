import express from 'express';
import { getServices, createService, updateService } from '../controllers/serviceController.js';

const router = express.Router();

router.get('/', getServices);
router.post('/', createService);
router.put('/:id', updateService);

export default router;