import mongoose from 'mongoose';

const memberSchema = new mongoose.Schema({
  memberId: { type: String, required: true, unique: true },
  fullName: { type: String, required: true },
  phone: { type: String, required: true },
  address: { type: String },
  registrationDate: { type: Date, default: Date.now },
  notes: { type: String }
}, { timestamps: true });

export default mongoose.model('Member', memberSchema);