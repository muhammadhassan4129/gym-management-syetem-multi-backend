import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema({
  invoiceNumber: { type: String, required: true, unique: true },
  memberId: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: true },
  serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
  billingPeriod: { type: String, required: true },
  amountCharged: { type: Number, required: true },
  amountPaid: { type: Number, required: true, default: 0 },
  remainingBalance: { type: Number, required: true },
  status: { type: String, enum: ['paid', 'partial', 'unpaid', 'overdue'], default: 'unpaid' },
  paymentDate: { type: Date }
}, { timestamps: true });

export default mongoose.model('Payment', paymentSchema);