import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import Admin from '../models/Admin.js';
import { Gym, Membership } from '../models/platform.js';

import { fail, requiredText } from '../utils/helpers.js';
import {
  bodyFields,
  objectId,
  password as validatePassword,
} from '../utils/validation.js';

function signToken(user, gymId = null) {
  return jwt.sign(
    {
      version: 2,
      tokenVersion: user.tokenVersion,
      gymId: gymId ? String(gymId) : null,
    },
    process.env.JWT_SECRET,
    {
      algorithm: 'HS256',
      subject: String(user._id),
      issuer: 'gym-platform',
      audience: 'gym-web',
      expiresIn: '8h',
    }
  );
}

function publicUser(user) {
  return {
    id: user._id,
    username: user.username,
    platformRole: user.platformRole,
  };
}

async function membershipsFor(userId) {
  return Membership.find({
    userId,
    isActive: true,
  })
    .populate('gymId', 'name slug status accessUntil lifetimeAccess')
    .lean();
}

export async function loginAdmin(req, res) {
  const body = bodyFields(req, ['username', 'password']);

  const name = requiredText(body.username, 'Username', 80);

  if (
    typeof body.password !== 'string' ||
    Buffer.byteLength(body.password, 'utf8') > 72
  ) {
    fail('Invalid username or password', 401);
  }

  const user = await Admin.findOne({ username: name }).select('+password');

  if (
    !user ||
    !user.isActive ||
    !(await bcrypt.compare(body.password, user.password))
  ) {
    fail('Invalid username or password', 401);
  }

  const memberships = await membershipsFor(user._id);
  const available = memberships.filter((item) => item.gymId);

  const selectedGym =
    user.platformRole !== 'super_admin' && available.length === 1
      ? available[0].gymId
      : null;

  res.json({
    token: signToken(user, selectedGym?._id),
    admin: publicUser(user),
    memberships: available,
    gym: selectedGym,
    requiresGymSelection:
      user.platformRole !== 'super_admin' && available.length !== 1,
  });
}

export async function getMe(req, res) {
  res.json({
    admin: publicUser(req.user),
    selectedGymId: req.auth.gymId,
    memberships: await membershipsFor(req.user._id),
  });
}

export async function selectGym(req, res) {
  const body = bodyFields(req, ['gymId']);
  const gymId = objectId(body.gymId, 'gym');

  const membership = await Membership.findOne({
    userId: req.user._id,
    gymId,
    isActive: true,
  });

  if (!membership) fail('Gym access denied', 403);

  const gym = await Gym.findById(gymId);

  if (!gym) fail('Gym not found', 404);

  res.json({
    token: signToken(req.user, gymId),
    gym,
    role: membership.role,
  });
}

export async function changePassword(req, res) {
  const body = bodyFields(req, ['currentPassword', 'newPassword']);

  const user = await Admin.findById(req.user._id).select('+password');

  if (
    typeof body.currentPassword !== 'string' ||
    !(await bcrypt.compare(body.currentPassword, user.password))
  ) {
    fail('Current password is incorrect', 400);
  }

  user.password = await bcrypt.hash(
    validatePassword(body.newPassword),
    12
  );

  user.tokenVersion += 1;
  await user.save();

  res.json({ message: 'Password changed. Please sign in again.' });
}

export async function logout(req, res) {
  await Admin.updateOne(
    { _id: req.user._id },
    { $inc: { tokenVersion: 1 } }
  );

  res.json({ message: 'Signed out from all sessions' });
}