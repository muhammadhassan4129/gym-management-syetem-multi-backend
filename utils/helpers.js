export const TIMEZONE = 'Asia/Karachi';

export function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

export const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

export function requiredText(value, label, maxLength = 200) {
  if (typeof value !== 'string' || !value.trim()) {
    fail(`${label} is required`);
  }

  const result = value.trim();

  if (result.length > maxLength) {
    fail(`${label} must not exceed ${maxLength} characters`);
  }

  return result;
}

export function optionalText(value, maxLength = 2000) {
  if (value === undefined || value === null) return '';

  if (typeof value !== 'string') {
    fail('Expected a text value');
  }

  if (value.length > maxLength) {
    fail(`Text must not exceed ${maxLength} characters`);
  }

  return value.trim();
}

export function money(value, label = 'Amount', allowZero = false) {
  if (
    value === undefined ||
    value === null ||
    value === '' ||
    !['string', 'number'].includes(typeof value)
  ) {
    fail(`${label} is required`);
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    fail(`${label} must be a valid number`);
  }

  if (number < 0 || (!allowZero && number === 0)) {
    fail(`${label} must be greater than ${allowZero ? 'or equal to 0' : '0'}`);
  }

  if (number > 1_000_000_000) {
    fail(`${label} is too large`);
  }

  const cents = Math.round(number * 100);

  if (Math.abs(number * 100 - cents) > 0.00001) {
    fail(`${label} can have at most 2 decimal places`);
  }

  return cents / 100;
}

export const toCents = (amount) => Math.round(Number(amount) * 100);

export const fromCents = (cents) => cents / 100;

export const sumMoney = (rows, getAmount) =>
  fromCents(
    rows.reduce((total, row) => total + toCents(getAmount(row)), 0)
  );

export function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function localDate(value = new Date()) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    fail('Invalid date');
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const get = (type) => parts.find((part) => part.type === type)?.value;

  return `${get('year')}-${get('month')}-${get('day')}`;
}

export const currentMonth = (value = new Date()) =>
  localDate(value).slice(0, 7);

export function parseDate(value, label = 'Date') {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    fail(`${label} must use YYYY-MM-DD format`);
  }

  const date = new Date(`${value}T00:00:00+05:00`);

  if (
    Number.isNaN(date.getTime()) ||
    localDate(date) !== value
  ) {
    fail(`${label} is invalid`);
  }

  return date;
}

export function validateMonth(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)
  ) {
    fail('Month must use YYYY-MM format');
  }

  const year = Number(value.slice(0, 4));

  if (year < 2000 || year > 2100) {
    fail('Month year must be between 2000 and 2100');
  }

  return value;
}

export function monthStart(value) {
  validateMonth(value);
  return parseDate(`${value}-01`);
}

export function nextMonth(value) {
  validateMonth(value);

  const [year, month] = value.split('-').map(Number);

  return month === 12
    ? `${year + 1}-01`
    : `${year}-${String(month + 1).padStart(2, '0')}`;
}

export const addDays = (date, days) =>
  new Date(new Date(date).getTime() + days * 24 * 60 * 60 * 1000);

export function dateRange(query) {
  const defaultMonth = currentMonth();

  const startDate = query.startDate || `${defaultMonth}-01`;

  const endDate =
    query.endDate ||
    localDate(addDays(monthStart(nextMonth(defaultMonth)), -1));

  const start = parseDate(startDate, 'startDate');
  const end = parseDate(endDate, 'endDate');

  if (end < start) {
    fail('endDate must be on or after startDate');
  }

  return {
    startDate,
    endDate,
    start,
    endExclusive: addDays(end, 1),
  };
}

export function paymentView(payment) {
  const result =
    typeof payment.toObject === 'function'
      ? payment.toObject()
      : { ...payment };

  result.isOverdue =
    result.remainingBalance > 0 &&
    Boolean(result.dueDate) &&
    new Date(result.dueDate).getTime() < Date.now();

  result.canPay = result.remainingBalance > 0;

  return result;
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  let status = error.status || 500;
  let message = error.message || 'Unexpected server error';

  if (error.code === 11000) {
    status = 409;
    message =
      'Duplicate record. An active subscription, invoice, or unique value already exists.';
  }

  if (
    error.name === 'ValidationError' ||
    error.name === 'CastError'
  ) {
    status = 400;
  }

  if (error.name === 'VersionError') {
    status = 409;
    message = 'Record changed. Refresh and try again.';
  }

  if (status >= 500) {
    console.error(error);
    message = 'Server error. Please try again.';
  }

  res.status(status).json({ message });
}