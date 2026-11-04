import mongoose from 'mongoose';

const expenseSchema = new mongoose.Schema({
  date: { type: Date, default: Date.now, required: true },
  category: { type: String, required: true }, // e.g., Electricity, Equipment, Rent
  amount: { type: Number, required: true },
  description: { type: String }
}, { timestamps: true });

export default mongoose.model('Expense', expenseSchema);