import { Service } from '../models/index.js';

import {
  fail,
  money,
  optionalText,
  requiredText,
} from '../utils/helpers.js';

export async function getServices(req, res) {
  const filter = {};

  if (req.query.active !== undefined) {
    if (!['true', 'false'].includes(req.query.active)) {
      fail('active must be true or false');
    }

    filter.isActive = req.query.active === 'true';
  }

  const services = await Service.find(filter).sort({ name: 1 });

  res.json(services);
}

export async function createService(req, res) {
  const service = await Service.create({
    name: requiredText(req.body.name, 'Service name', 120),
    fee: money(req.body.fee, 'Service fee'),

    description: optionalText(req.body.description),
    isActive: true,
  });

  res.status(201).json(service);
}

export async function updateService(req, res) {
  const service = await Service.findById(req.params.id);

  if (!service) fail('Service not found', 404);

  if (req.body.name !== undefined) {
    service.name = requiredText(req.body.name, 'Service name', 120);
  }

  if (req.body.fee !== undefined) {
    service.fee = money(req.body.fee, 'Service fee');
  }

  if (req.body.description !== undefined) {
    service.description = optionalText(req.body.description);
  }

  if (req.body.isActive !== undefined) {
    if (typeof req.body.isActive !== 'boolean') {
      fail('isActive must be a boolean');
    }

    service.isActive = req.body.isActive;
  }

  await service.save();

  res.json(service);
}