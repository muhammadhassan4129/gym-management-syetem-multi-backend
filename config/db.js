import mongoose from 'mongoose';

let connectionPromise = null;

export async function connectDB() {
  if (mongoose.connection.readyState === 1) return;

  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required');
  }

  if (!connectionPromise) {
    connectionPromise = mongoose
      .connect(process.env.MONGO_URI, {
        autoIndex: false,
        serverSelectionTimeoutMS: 15000,
      })
      .finally(() => {
        connectionPromise = null;
      });
  }

  await connectionPromise;
}