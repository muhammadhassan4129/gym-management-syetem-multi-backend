import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import Admin from './models/Admin.js';

dotenv.config();

const seedAdmin = async () => {
  try {
    const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/gym-management';
    await mongoose.connect(MONGO_URI);

    const existingAdmin = await Admin.findOne({ username: 'admin' });
    if (existingAdmin) {
      console.log('Admin already exists!');
      process.exit();
    }

    const hashedPassword = await bcrypt.hash('admin123', 10);
    const newAdmin = new Admin({
      username: 'admin',
      password: hashedPassword
    });

    await newAdmin.save();
    console.log('Default Admin Created Successfully!');
    console.log('Username: admin');
    console.log('Password: admin123');
    process.exit();
  } catch (error) {
    console.error('Error seeding admin:', error);
    process.exit(1);
  }
};

seedAdmin();