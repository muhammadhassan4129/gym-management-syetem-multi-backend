import mongoose from 'mongoose';

const adminSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 80,
    },

    password: {
      type: String,
      required: true,
      select: false,
    },

    platformRole: {
      type: String,
      enum: ['user', 'super_admin'],
      default: 'user',
      required: true,
    },

    isActive: {
      type: Boolean,
      default: true,
      required: true,
    },

    tokenVersion: {
      type: Number,
      default: 1,
      required: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model('Admin', adminSchema);