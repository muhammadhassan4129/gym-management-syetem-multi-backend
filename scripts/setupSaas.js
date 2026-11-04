import 'dotenv/config';

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

import { connectDB } from '../config/db.js';

import Admin from '../models/Admin.js';

import {
  Gym,
  Membership,
  Plan,
  PlatformInvoice,
  Audit,
} from '../models/platform.js';

import {
  Member,
  Service,
  Subscription,
  Payment,
  Expense,
} from '../models/index.js';

import { addDays, parseDate } from '../utils/helpers.js';
import {
  password,
  username,
} from '../utils/validation.js';

const businessModels = [
  Member,
  Service,
  Subscription,
  Payment,
  Expense,
];

async function hasCollection(name) {
  return mongoose.connection.db
    .listCollections({ name })
    .hasNext();
}

async function dropOldIndex(model, expectedKey) {
  if (!(await hasCollection(model.collection.name))) return;

  const indexes = await model.collection.indexes();

  for (const index of indexes) {
    if (
      index.unique &&
      JSON.stringify(index.key) === JSON.stringify(expectedKey)
    ) {
      await model.collection.dropIndex(index.name);
    }
  }
}

async function main() {
  await connectDB();

  const db = mongoose.connection.db;

  const superName = username(process.env.SUPER_ADMIN_USERNAME);
  const superPassword = password(process.env.SUPER_ADMIN_PASSWORD);

  const superHash = await bcrypt.hash(superPassword, 12);

  const superExisting = await Admin.collection.findOne({
    username: superName,
  });

  if (
    superExisting &&
    superExisting.platformRole !== 'super_admin'
  ) {
    throw new Error(
      'SUPER_ADMIN_USERNAME belongs to an existing gym account. Choose a separate username.'
    );
  }

  const counts = [];

  for (const model of businessModels) {
    counts.push(
      await model.collection.countDocuments({
        gymId: { $exists: false },
      })
    );

    const nullGym = await model.collection.findOne({ gymId: null });

    if (nullGym && Object.prototype.hasOwnProperty.call(nullGym, 'gymId')) {
      throw new Error(
        `${model.modelName} has an explicit null gymId. Reconcile it before setup.`
      );
    }
  }

  const hasLegacy = counts.some((count) => count > 0);

  let owner;
  let targetGym;
  let targetGymId;
  let accessUntil;

  if (hasLegacy) {
    const ownerName = username(process.env.LEGACY_OWNER_USERNAME);

    if (ownerName === superName) {
      throw new Error('Gym Owner and Super Admin must be separate accounts');
    }

    owner = await Admin.collection.findOne({ username: ownerName });

    if (!owner) {
      throw new Error('Existing gym owner account was not found');
    }

    const slug = process.env.LEGACY_GYM_SLUG || 'yaseen-gym';

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      throw new Error('Invalid LEGACY_GYM_SLUG');
    }

    targetGym = await Gym.findOne({ slug });

    if (
      targetGym &&
      String(targetGym.ownerId) !== String(owner._id)
    ) {
      throw new Error('Existing gym slug belongs to another owner');
    }

    targetGymId = targetGym?._id || new mongoose.Types.ObjectId();

    accessUntil = addDays(
      parseDate(process.env.LEGACY_ACCESS_UNTIL, 'Legacy access date'),
      1
    );

    const allowedGym = {
      $or: [
        { gymId: { $exists: false } },
        { gymId: targetGymId },
      ],
    };

    for (const model of [Subscription, Payment]) {
      const invalid = await model.collection.findOne({
        gymId: { $exists: false },
        billingVersion: { $ne: 2 },
      });

      if (invalid) {
        throw new Error(
          `${model.modelName} ${invalid._id} needs the earlier billing migration first`
        );
      }
    }

    // Validate existing tenant relationships before assigning ownership.
    for (const model of [Subscription, Payment]) {
      const cursor = model.collection.find({
        gymId: { $exists: false },
      });

      for await (const row of cursor) {
        const member = await Member.collection.findOne({
          _id: row.memberId,
          ...allowedGym,
        });

        const service = await Service.collection.findOne({
          _id: row.serviceId,
          ...allowedGym,
        });

        if (!member || !service) {
          throw new Error(
            `${model.modelName} ${row._id} has missing or conflicting references`
          );
        }

        if (row.subscriptionId) {
          const subscription = await Subscription.collection.findOne({
            _id: row.subscriptionId,
            ...allowedGym,
          });

          if (
            !subscription ||
            String(subscription.memberId) !== String(row.memberId) ||
            String(subscription.serviceId) !== String(row.serviceId)
          ) {
            throw new Error(
              `Invoice ${row._id} has an invalid subscription reference`
            );
          }
        }
      }
    }
  }

  await db.collection('systemsettings').updateOne(
    { _id: 'multitenant-v1' },
    { $set: { ready: false, startedAt: new Date() } },
    { upsert: true }
  );

  await mongoose.connection.transaction(async (session) => {
    if (!superExisting) {
      await Admin.create(
        [{
          username: superName,
          password: superHash,
          platformRole: 'super_admin',
          isActive: true,
          tokenVersion: 1,
        }],
        { session }
      );
    }

    // Normalize old accounts without granting them gym access.
    await Admin.collection.updateMany(
      { platformRole: { $exists: false } },
      {
        $set: {
          platformRole: 'user',
          isActive: true,
          tokenVersion: 1,
        },
      },
      { session }
    );

    if (hasLegacy) {
      if (!targetGym) {
        await Gym.create(
          [{
            _id: targetGymId,
            name: process.env.LEGACY_GYM_NAME || 'Yaseen Gym',
            slug: process.env.LEGACY_GYM_SLUG || 'yaseen-gym',
            ownerId: owner._id,
            accessUntil,
            status: 'active',
            lifetimeAccess: false,
          }],
          { session }
        );
      }

      await Membership.updateOne(
        {
          gymId: targetGymId,
          userId: owner._id,
        },
        {
          $set: {
            role: 'owner',
            isActive: true,
          },
        },
        { upsert: true, session, runValidators: true }
      );

      for (const model of businessModels) {
        await model.collection.updateMany(
          { gymId: { $exists: false } },
          { $set: { gymId: targetGymId } },
          { session }
        );
      }
    }
  });

  // Create scoped indexes before dropping old global indexes.
  const allModels = [
    Admin,
    Gym,
    Membership,
    Plan,
    PlatformInvoice,
    Audit,
    ...businessModels,
  ];

  for (const model of allModels) {
    await model.createIndexes();
  }

  await dropOldIndex(Member, { memberId: 1 });
  await dropOldIndex(Service, { name: 1 });
  await dropOldIndex(Payment, { invoiceNumber: 1 });
  await dropOldIndex(Subscription, { memberId: 1, serviceId: 1 });
  await dropOldIndex(Payment, { subscriptionId: 1, billingMonth: 1 });

  for (const model of businessModels) {
    const unassigned = await model.collection.findOne({
      $or: [
        { gymId: { $exists: false } },
        { gymId: null },
      ],
    });

    if (unassigned) {
      throw new Error(`${model.modelName} still has unassigned records`);
    }
  }

  await db.collection('systemsettings').updateOne(
    { _id: 'multitenant-v1' },
    {
      $set: {
        ready: true,
        completedAt: new Date(),
      },
    }
  );

  console.log('Multi-tenant platform setup completed.');
  console.log(`Super Admin username: ${superName}`);

  if (hasLegacy) {
    console.log(`Existing gym assigned: ${targetGymId}`);
    console.log('Existing invoices and payment amounts were preserved.');
  }

  console.log('All users must sign in again.');
}

main()
  .catch((error) => {
    console.error('Setup failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });