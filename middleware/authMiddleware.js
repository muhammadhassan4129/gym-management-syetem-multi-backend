import jwt from 'jsonwebtoken';

import Admin from '../models/Admin.js';
import { Gym, Membership } from '../models/platform.js';

import { asyncHandler, fail } from '../utils/helpers.js';
import { objectId } from '../utils/validation.js';

export const verifyToken = asyncHandler(async (req, res, next) => {
  const authorization = req.get('Authorization') || '';
  const match = authorization.match(/^Bearer ([^\s]+)$/);

  if (!match) fail('Authentication required', 401);

  let decoded;

  try {
    decoded = jwt.verify(match[1], process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'gym-platform',
      audience: 'gym-web',
    });
  } catch {
    fail('Invalid or expired token', 401);
  }

  if (
    !decoded ||
    decoded.version !== 2 ||
    typeof decoded.sub !== 'string'
  ) {
    fail('Please sign in again', 401);
  }

  const user = await Admin.findById(
    objectId(decoded.sub, 'token user')
  );

  if (
    !user ||
    !user.isActive ||
    decoded.tokenVersion !== user.tokenVersion
  ) {
    fail('Session is no longer valid', 401);
  }

  req.user = user;
  req.auth = decoded;

  next();
});

export function requireSuperAdmin(req, res, next) {
  if (req.user.platformRole !== 'super_admin') {
    return res.status(403).json({ message: 'Super Admin access required' });
  }

  next();
}

export function gymAccess(gym) {
  return (
    gym.status === 'active' &&
    (
      gym.lifetimeAccess ||
      new Date(gym.accessUntil).getTime() > Date.now()
    )
  );
}

// allowExpired is used only for the owner's software billing page.
export function requireGym({ allowExpired = false } = {}) {
  return asyncHandler(async (req, res, next) => {
    if (!req.auth.gymId) {
      fail('Select a gym first', 403);
    }

    const gymId = objectId(req.auth.gymId, 'gym');

    const membership = await Membership.findOne({
      userId: req.user._id,
      gymId,
      isActive: true,
    });

    if (!membership) fail('Gym access denied', 403);

    const gym = await Gym.findById(gymId);

    if (!gym) fail('Gym not found', 404);

    if (!allowExpired && !gymAccess(gym)) {
      fail(
        gym.status !== 'active'
          ? 'Gym access is suspended or closed'
          : 'Software subscription expired. Contact the platform administrator.',
        403
      );
    }

    req.gym = gym;
    req.membership = membership;

    next();
  });
}

export function roles(...allowed) {
  return (req, res, next) => {
    if (!allowed.includes(req.membership?.role)) {
      return res.status(403).json({
        message: 'You do not have permission for this action',
      });
    }

    next();
  };
}