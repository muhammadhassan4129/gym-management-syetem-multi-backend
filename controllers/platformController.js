import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';

import Admin from '../models/Admin.js';

import {
  Gym,
  Membership,
  Plan,
  PlatformInvoice,
  Audit,
} from '../models/platform.js';

import {
  addDays,
  fail,
  money,
  optionalText,
  requiredText,
} from '../utils/helpers.js';

import {
  bodyFields,
  booleanValue,
  integer,
  objectId,
  password,
  username,
} from '../utils/validation.js';

import { gymAccess } from '../middleware/authMiddleware.js';

async function audit(req, action, targetId, gymId, session, details = {}) {
  await Audit.create(
    [{
      actorId: req.user._id,
      action,
      targetId,
      gymId,
      details,
    }],
    { session }
  );
}

function addMonthsClamped(date, months) {
  const result = new Date(date);
  const day = result.getUTCDate();

  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);

  const lastDay = new Date(Date.UTC(
    result.getUTCFullYear(),
    result.getUTCMonth() + 1,
    0
  )).getUTCDate();

  result.setUTCDate(Math.min(day, lastDay));

  return result;
}

// ─── Plans ─────────────────────────────────────

export async function listPlans(req, res) {
  res.json(await Plan.find().sort({ createdAt: -1 }));
}

export async function createPlan(req, res) {
  const body = bodyFields(req, ['name', 'price', 'interval']);

  if (!['monthly', 'yearly', 'one-time'].includes(body.interval)) {
    fail('Invalid plan interval');
  }

  res.status(201).json(await Plan.create({
    name: requiredText(body.name, 'Plan name', 100),
    price: money(body.price, 'Plan price'),
    interval: body.interval,
    isActive: true,
  }));
}

export async function updatePlan(req, res) {
  const body = bodyFields(req, ['name', 'price', 'isActive']);

  const plan = await Plan.findById(objectId(req.params.id));

  if (!plan) fail('Plan not found', 404);

  if (body.name !== undefined) {
    plan.name = requiredText(body.name, 'Plan name', 100);
  }

  if (body.price !== undefined) {
    plan.price = money(body.price, 'Plan price');
  }

  if (body.isActive !== undefined) {
    plan.isActive = booleanValue(body.isActive, 'isActive');
  }

  await plan.save();
  res.json(plan);
}

// ─── Gyms ──────────────────────────────────────

export async function listGyms(req, res) {
  const gyms = await Gym.find()
    .populate('ownerId', 'username')
    .sort({ createdAt: -1 })
    .lean();

  res.json(gyms.map((gym) => ({
    ...gym,
    canAccess: gymAccess(gym),
  })));
}

export async function createGym(req, res) {
  const body = bodyFields(req, [
    'name', 'slug', 'phone', 'address',
    'ownerUsername', 'ownerPassword', 'trialDays',
  ]);

  const slug = requiredText(body.slug, 'Gym slug', 80).toLowerCase();

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    fail('Use lowercase letters, numbers and hyphens in gym slug');
  }

  const ownerUsername = username(body.ownerUsername);
  const trialDays = integer(body.trialDays ?? 7, 'Trial days', 0, 30);

  const existingOwner = await Admin.findOne({
    username: ownerUsername,
  });

  if (existingOwner?.platformRole === 'super_admin') {
    fail('Use a separate gym owner account');
  }

  if (existingOwner && !existingOwner.isActive) {
    fail('Owner account is disabled');
  }

  if (existingOwner && body.ownerPassword !== undefined) {
    fail('Do not provide a password when assigning an existing owner account');
  }

  const passwordHash = existingOwner
    ? null
    : await bcrypt.hash(password(body.ownerPassword), 12);

  const result = await mongoose.connection.transaction(async (session) => {
    let owner = existingOwner;

    if (!owner) {
      [owner] = await Admin.create(
        [{
          username: ownerUsername,
          password: passwordHash,
          platformRole: 'user',
          isActive: true,
          tokenVersion: 1,
        }],
        { session }
      );
    }

    const [gym] = await Gym.create(
      [{
        name: requiredText(body.name, 'Gym name', 120),
        slug,
        ownerId: owner._id,
        phone: optionalText(body.phone, 30),
        address: optionalText(body.address, 500),
        accessUntil: addDays(new Date(), trialDays),
      }],
      { session }
    );

    await Membership.create(
      [{
        gymId: gym._id,
        userId: owner._id,
        role: 'owner',
        isActive: true,
      }],
      { session }
    );

    await audit(req, 'gym.created', gym._id, gym._id, session);

    return {
      gym,
      owner: { id: owner._id, username: owner.username },
    };
  });

  res.status(201).json(result);
}

export async function updateGymStatus(req, res) {
  const body = bodyFields(req, ['status']);

  if (!['active', 'suspended', 'closed'].includes(body.status)) {
    fail('Invalid gym status');
  }

  const gymId = objectId(req.params.id);

  const gym = await mongoose.connection.transaction(async (session) => {
    const updated = await Gym.findOneAndUpdate(
      { _id: gymId },
      { $set: { status: body.status }, $inc: { billingRevision: 1 } },
      { new: true, runValidators: true, session }
    );

    if (!updated) fail('Gym not found', 404);

    await audit(req, 'gym.status', gymId, gymId, session, {
      status: body.status,
    });

    return updated;
  });

  res.json(gym);
}

// ─── Software invoices ─────────────────────────

export async function listPlatformInvoices(req, res) {
  const filter = {};

  if (req.query.gymId) {
    filter.gymId = objectId(req.query.gymId, 'gym');
  }

  res.json(await PlatformInvoice.find(filter)
    .populate('gymId', 'name slug')
    .sort({ createdAt: -1 }));
}

export async function issuePlatformInvoice(req, res) {
  const body = bodyFields(req, ['planId']);
  const gymId = objectId(req.params.id, 'gym');
  const planId = objectId(body.planId, 'plan');

  const invoice = await mongoose.connection.transaction(async (session) => {
    const gym = await Gym.findOneAndUpdate(
      { _id: gymId },
      { $inc: { billingRevision: 1 } },
      { new: true, session }
    );

    if (!gym) fail('Gym not found', 404);
    if (gym.lifetimeAccess) fail('Gym already has one-time lifetime access');

    const plan = await Plan.findOne({
      _id: planId,
      isActive: true,
    }).session(session);

    if (!plan) fail('Active plan not found', 404);

    const existing = await PlatformInvoice.findOne({
      gymId,
      status: 'unpaid',
    }).session(session);

    // Safe retry of the same issuance request.
    if (existing) {
      if (String(existing.planId) !== String(planId)) {
        fail('An unpaid invoice already exists. Void it before changing plan.', 409);
      }

      return existing;
    }

    const now = new Date();
    const start = new Date(gym.accessUntil) > now
      ? new Date(gym.accessUntil)
      : now;

    const end = plan.interval === 'one-time'
      ? null
      : addMonthsClamped(start, plan.interval === 'yearly' ? 12 : 1);

    const [created] = await PlatformInvoice.create(
      [{
        gymId,
        planId,
        invoiceNumber: `SAAS-${randomUUID().toUpperCase()}`,
        planName: plan.name,
        interval: plan.interval,
        amount: plan.price,
        periodStart: start,
        periodEnd: end,
        status: 'unpaid',
      }],
      { session }
    );

    await audit(req, 'software.invoice.created', created._id, gymId, session);

    return created;
  });

  res.status(201).json(invoice);
}

export async function payPlatformInvoice(req, res) {
  const body = bodyFields(req, ['idempotencyKey', 'reference']);

  const id = objectId(req.params.id, 'invoice');

  const paymentKey = requiredText(
    body.idempotencyKey,
    'Idempotency key',
    100
  );

  const reference = optionalText(body.reference, 200);

  const invoice = await mongoose.connection.transaction(async (session) => {
    const item = await PlatformInvoice.findById(id).session(session);

    if (!item) fail('Software invoice not found', 404);
    if (item.status === 'void') fail('Invoice is void', 409);

    if (item.status === 'paid') {
      if (
        item.paymentKey !== paymentKey ||
        item.paymentReference !== reference
      ) {
        fail('Invoice has already been paid', 409);
      }

      return item;
    }

    const gym = await Gym.findOneAndUpdate(
      { _id: item.gymId },
      { $inc: { billingRevision: 1 } },
      { new: true, session }
    );

    if (!gym) fail('Gym not found', 404);

    if (item.periodEnd && item.periodEnd <= new Date()) {
      fail('Invoice coverage has already ended. Void it and issue a new invoice.', 409);
    }

    item.status = 'paid';
    item.paidAt = new Date();
    item.paidBy = req.user._id;
    item.paymentReference = reference;
    item.paymentKey = paymentKey;

    await item.save({ session });

    if (item.interval === 'one-time') {
      gym.lifetimeAccess = true;
    } else if (item.periodEnd > gym.accessUntil) {
      gym.accessUntil = item.periodEnd;
    }

    // Payment does not override an explicit suspension.
    await gym.save({ session });

    await audit(req, 'software.invoice.paid', item._id, gym._id, session, {
      amount: item.amount,
      reference,
    });

    return item;
  });

  res.json(invoice);
}

export async function voidPlatformInvoice(req, res) {
  const id = objectId(req.params.id);

  const invoice = await mongoose.connection.transaction(async (session) => {
    const item = await PlatformInvoice.findById(id).session(session);

    if (!item) fail('Invoice not found', 404);
    if (item.status === 'paid') fail('Paid invoices cannot be voided', 409);
    if (item.status === 'void') return item;

    item.status = 'void';
    await item.save({ session });

    await audit(req, 'software.invoice.void', item._id, item.gymId, session);

    return item;
  });

  res.json(invoice);
}

// ─── Owner billing/settings ────────────────────

export async function ownBilling(req, res) {
  res.json({
    gym: req.gym,
    canAccess: gymAccess(req.gym),
    invoices: await PlatformInvoice.find({
      gymId: req.gym._id,
    }).sort({ createdAt: -1 }),
  });
}

export async function updateOwnGym(req, res) {
  const body = bodyFields(req, ['name', 'phone', 'address']);

  const gym = await Gym.findById(req.gym._id);

  if (body.name !== undefined) {
    gym.name = requiredText(body.name, 'Gym name', 120);
  }

  if (body.phone !== undefined) {
    gym.phone = optionalText(body.phone, 30);
  }

  if (body.address !== undefined) {
    gym.address = optionalText(body.address, 500);
  }

  await gym.save();

  res.json(gym);
}

// ─── Staff ─────────────────────────────────────

export async function listStaff(req, res) {
  res.json(await Membership.find({ gymId: req.gym._id })
    .populate('userId', 'username isActive')
    .sort({ createdAt: 1 }));
}

export async function createStaff(req, res) {
  const body = bodyFields(req, ['username', 'password', 'role']);

  if (!['manager', 'receptionist'].includes(body.role)) {
    fail('Staff role must be manager or receptionist');
  }

  const name = username(body.username);
  const hash = await bcrypt.hash(password(body.password), 12);

  // Owners can create new staff accounts; they cannot attach an
  // unrelated existing user to their gym.
  const result = await mongoose.connection.transaction(async (session) => {
    const [user] = await Admin.create(
      [{
        username: name,
        password: hash,
        platformRole: 'user',
        isActive: true,
      }],
      { session }
    );

    const [membership] = await Membership.create(
      [{
        gymId: req.gym._id,
        userId: user._id,
        role: body.role,
        isActive: true,
      }],
      { session }
    );

    await audit(
      req,
      'staff.created',
      membership._id,
      req.gym._id,
      session
    );

    return {
      membership,
      user: { id: user._id, username: user.username },
    };
  });

  res.status(201).json(result);
}

export async function updateStaff(req, res) {
  const body = bodyFields(req, ['role', 'isActive']);

  const membership = await Membership.findOne({
    _id: objectId(req.params.id),
    gymId: req.gym._id,
  });

  if (!membership) fail('Staff member not found', 404);
  if (membership.role === 'owner') fail('Owner cannot be edited through staff routes');

  if (body.role !== undefined) {
    if (!['manager', 'receptionist'].includes(body.role)) {
      fail('Invalid staff role');
    }

    membership.role = body.role;
  }

  if (body.isActive !== undefined) {
    membership.isActive = booleanValue(body.isActive, 'isActive');
  }

  await membership.save();
  res.json(membership);
}

export async function resetUserPassword(req, res) {
  const body = bodyFields(req, ['newPassword']);
  const id = objectId(req.params.id);

  const user = await Admin.findOne({
    _id: id,
    platformRole: 'user',
  }).select('+password');

  if (!user) fail('User not found', 404);

  user.password = await bcrypt.hash(password(body.newPassword), 12);
  user.tokenVersion += 1;

  await user.save();

  res.json({ message: 'Password reset; existing sessions revoked' });
}