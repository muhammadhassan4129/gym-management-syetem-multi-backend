import mongoose from 'mongoose';

const { Schema } = mongoose;

const ref = (model) => ({
  type: Schema.Types.ObjectId,
  ref: model,
  required: true,
});

const amount = {
  type: Number,
  required: true,
  min: 0,
  validate: {
    validator: (value) =>
      Number.isFinite(value) &&
      Math.abs(value * 100 - Math.round(value * 100)) < 0.00001,
    message: 'Invalid monetary amount',
  },
};

const gymSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      maxlength: 120,
    },

    slug: {
      type: String,
      required: true,
      unique: true,
    },

    ownerId: ref('Admin'),

    phone: { type: String, default: '', maxlength: 30 },
    address: { type: String, default: '', maxlength: 500 },

    status: {
      type: String,
      enum: ['active', 'suspended', 'closed'],
      default: 'active',
    },

    currency: {
      type: String,
      enum: ['PKR'],
      default: 'PKR',
    },

    timezone: {
      type: String,
      enum: ['Asia/Karachi'],
      default: 'Asia/Karachi',
    },

    accessUntil: {
      type: Date,
      required: true,
    },

    lifetimeAccess: {
      type: Boolean,
      default: false,
    },

    // Serializes platform billing operations for this gym.
    billingRevision: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

const membershipSchema = new Schema(
  {
    gymId: ref('Gym'),
    userId: ref('Admin'),

    role: {
      type: String,
      enum: ['owner', 'manager', 'receptionist'],
      required: true,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

membershipSchema.index(
  { gymId: 1, userId: 1 },
  { unique: true }
);

membershipSchema.index({ userId: 1, isActive: 1 });

const planSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      maxlength: 100,
    },

    price: amount,

    interval: {
      type: String,
      enum: ['monthly', 'yearly', 'one-time'],
      required: true,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

const platformInvoiceSchema = new Schema(
  {
    gymId: ref('Gym'),
    planId: ref('Plan'),

    invoiceNumber: {
      type: String,
      required: true,
      unique: true,
    },

    // Snapshot: later plan changes do not change this invoice.
    planName: { type: String, required: true },

    interval: {
      type: String,
      enum: ['monthly', 'yearly', 'one-time'],
      required: true,
    },

    amount: amount,

    currency: {
      type: String,
      enum: ['PKR'],
      default: 'PKR',
    },

    periodStart: {
      type: Date,
      required: true,
    },

    periodEnd: Date,

    status: {
      type: String,
      enum: ['unpaid', 'paid', 'void'],
      default: 'unpaid',
    },

    paidAt: Date,
    paidBy: { type: Schema.Types.ObjectId, ref: 'Admin' },
    paymentReference: { type: String, maxlength: 200 },
    paymentKey: String,
  },
  { timestamps: true }
);

// One open software invoice per gym.
platformInvoiceSchema.index(
  { gymId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'unpaid' },
  }
);

const auditSchema = new Schema(
  {
    gymId: {
      type: Schema.Types.ObjectId,
      ref: 'Gym',
    },

    actorId: ref('Admin'),
    action: { type: String, required: true },
    targetId: Schema.Types.ObjectId,
    details: Schema.Types.Mixed,
  },
  { timestamps: true }
);

auditSchema.index({ gymId: 1, createdAt: -1 });

export const Gym = mongoose.model('Gym', gymSchema);
export const Membership = mongoose.model('Membership', membershipSchema);
export const Plan = mongoose.model('Plan', planSchema);
export const PlatformInvoice = mongoose.model(
  'PlatformInvoice',
  platformInvoiceSchema
);
export const Audit = mongoose.model('Audit', auditSchema);