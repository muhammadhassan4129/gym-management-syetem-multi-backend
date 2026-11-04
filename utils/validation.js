import mongoose from 'mongoose';
import { fail, requiredText } from './helpers.js';

export function objectId(value, label = 'ID') {
  if (
    typeof value !== 'string' ||
    !/^[a-fA-F0-9]{24}$/.test(value)
  ) {
    fail(`Invalid ${label}`);
  }

  return new mongoose.Types.ObjectId(value);
}

export function username(value) {
  const result = requiredText(value, 'Username', 80);

  if (!/^[a-zA-Z0-9._@-]+$/.test(result)) {
    fail('Username can contain letters, numbers, dot, underscore, @ and hyphen');
  }

  return result;
}

export function password(value) {
  if (
    typeof value !== 'string' ||
    value.length < 12 ||
    Buffer.byteLength(value, 'utf8') > 72
  ) {
    fail('Password must contain at least 12 characters and at most 72 UTF-8 bytes');
  }

  return value;
}

export function booleanValue(value, label) {
  if (typeof value !== 'boolean') {
    fail(`${label} must be a boolean`);
  }

  return value;
}

export function integer(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(`${label} must be an integer from ${min} to ${max}`);
  }

  return value;
}

// Explicit allow-list: clients cannot inject gymId or other fields.
export function bodyFields(req, allowed) {
  const body = req.body;

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    fail('A JSON object is required');
  }

  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      fail(`Unsupported field: ${key}`);
    }
  }

  return body;
}

export function populateMember(gymId) {
  return {
    path: 'memberId',
    select: 'fullName phone memberId address',
    match: { gymId },
  };
}

export function populateService(gymId) {
  return {
    path: 'serviceId',
    select: 'name fee',
    match: { gymId },
  };
}