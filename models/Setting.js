import mongoose from 'mongoose';

const settingSchema = new mongoose.Schema({
  gymName: { type: String, required: true, default: 'My Gym' },
  phone: { type: String },
  address: { type: String },
  invoiceHeader: { type: String }
}, { timestamps: true });

export default mongoose.model('Setting', settingSchema);