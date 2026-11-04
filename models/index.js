import mongoose from 'mongoose';

const { Schema } = mongoose;

const gymField = {
  type: Schema.Types.ObjectId,
  ref: 'Gym',
  required: true,
  immutable: true,
};

const moneyField = {
  type: Number,
  min: 0,
  required: true,
  validate: {
    validator: (value) =>
      Number.isFinite(value) &&
      Math.abs(value * 100 - Math.round(value * 100)) < 0.00001,
    message: 'Amount must have at most 2 decimal places',
  },
};

const reference = (model) => ({
  type: Schema.Types.ObjectId,
  ref: model,
  required: true,
});

const memberSchema = new Schema(
  {
    gymId: gymField,
    memberId: { type: String, required: true },
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, required: true, trim: true, maxlength: 30 },
    address: { type: String, default: '', maxlength: 500 },
    registrationDate: { type: Date, default: Date.now, required: true },
    notes: { type: String, default: '', maxlength: 2000 },
  },
  { timestamps: true }
);

memberSchema.index({ gymId: 1, memberId: 1 }, { unique: true });
memberSchema.index({ gymId: 1, createdAt: -1 });

const serviceSchema = new Schema(
  {
    gymId: gymField,
    name: { type: String, required: true, trim: true, maxlength: 120 },
    fee: moneyField,
    description: { type: String, default: '', maxlength: 2000 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

serviceSchema.index({ gymId: 1, name: 1 }, { unique: true });

const subscriptionSchema = new Schema(
  {
    gymId: gymField,
    memberId: reference('Member'),
    serviceId: reference('Service'),
    fee: moneyField,

    billingMethod: {
      type: String,
      enum: ['calendar-month'],
      default: 'calendar-month',
      required: true,
    },

    startDate: { type: Date, required: true },
    nextBillingDate: { type: Date, required: true },
    dueDate: { type: Date, required: true },

    status: {
      type: String,
      enum: ['active', 'expired', 'cancelled'],
      default: 'active',
    },

    cancelledAt: Date,
    billingVersion: { type: Number, default: 2, required: true },
  },
  { timestamps: true, optimisticConcurrency: true }
);

subscriptionSchema.index(
  { gymId: 1, memberId: 1, serviceId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active' },
  }
);

subscriptionSchema.index({
  gymId: 1,
  status: 1,
  nextBillingDate: 1,
});

const receiptSchema = new Schema({
  receiptNumber: { type: String, required: true },
  idempotencyKey: { type: String, required: true },
  amount: moneyField,

  method: {
    type: String,
    enum: ['cash', 'bank', 'card', 'other'],
    required: true,
  },

  reference: { type: String, default: '', maxlength: 200 },
  note: { type: String, default: '', maxlength: 1000 },
  receivedAt: { type: Date, default: Date.now, required: true },

  receivedBy: {
    type: Schema.Types.ObjectId,
    ref: 'Admin',
  },
});

const paymentSchema = new Schema(
  {
    gymId: gymField,

    invoiceNumber: { type: String, required: true },

    memberId: reference('Member'),
    serviceId: reference('Service'),

    subscriptionId: {
      type: Schema.Types.ObjectId,
      ref: 'Subscription',
    },

    serviceName: { type: String, default: '' },

    billingMonth: {
      type: String,
      match: /^\d{4}-(0[1-9]|1[0-2])$/,
    },

    billingPeriod: { type: String, required: true },
    periodStart: Date,
    periodEnd: Date,
    dueDate: Date,

    amountCharged: moneyField,
    amountPaid: { ...moneyField, default: 0 },
    remainingBalance: moneyField,

    status: {
      type: String,
      enum: ['paid', 'partial', 'unpaid'],
      default: 'unpaid',
    },

    paymentDate: Date,

    transactions: {
      type: [receiptSchema],
      default: [],
    },

    legacyPaidAmount: { ...moneyField, default: 0 },
    legacy: { type: Boolean, default: false },
    billingVersion: { type: Number, default: 2, required: true },
  },
  { timestamps: true, optimisticConcurrency: true }
);

paymentSchema.index(
  { gymId: 1, invoiceNumber: 1 },
  { unique: true }
);

paymentSchema.index(
  { gymId: 1, subscriptionId: 1, billingMonth: 1 },
  {
    unique: true,
    partialFilterExpression: {
      subscriptionId: { $type: 'objectId' },
      billingMonth: { $type: 'string' },
    },
  }
);

paymentSchema.index({ gymId: 1, billingMonth: 1, status: 1 });
paymentSchema.index({ gymId: 1, memberId: 1, createdAt: -1 });
paymentSchema.index({ gymId: 1, 'transactions.receivedAt': 1 });

const expenseSchema = new Schema(
  {
    gymId: gymField,
    date: { type: Date, default: Date.now, required: true },
    category: { type: String, required: true, trim: true, maxlength: 100 },
    amount: moneyField,
    description: { type: String, default: '', maxlength: 2000 },
  },
  { timestamps: true }
);

expenseSchema.index({ gymId: 1, date: -1 });

export const Member = mongoose.model('Member', memberSchema);
export const Service = mongoose.model('Service', serviceSchema);
export const Subscription = mongoose.model('Subscription', subscriptionSchema);
export const Payment = mongoose.model('Payment', paymentSchema);
export const Expense = mongoose.model('Expense', expenseSchema);