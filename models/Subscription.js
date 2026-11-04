import mongoose from 'mongoose';

const subscriptionSchema = new mongoose.Schema({
  memberId: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: true },
  serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
  fee: { type: Number, required: true },
  billingMethod: { type: String, enum: ['calendar-month', 'rolling-duration'], required: true },
  startDate: { type: Date, required: true },
  dueDate: { type: Date, required: true },
  status: { type: String, enum: ['active', 'expired', 'cancelled'], default: 'active' }
}, { timestamps: true });

export default mongoose.model('Subscription', subscriptionSchema);