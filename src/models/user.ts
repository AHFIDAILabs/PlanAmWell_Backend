import mongoose, { Document, Schema } from "mongoose";
import bcrypt from 'bcryptjs';
import { IImage } from "./image";

// --- Extended User Interface ---
export interface IUser extends Document {
  phone?: string;
  email?: string;
  name?: string;
  gender?: string;
  password?: string;
  confirmPassword?: string;
  dateOfBirth?: string;
  homeAddress?: string;
  city?: string;
  state?: string;
  lga?: string;
  userImage?: IImage | mongoose.Types.ObjectId;
  roles?: string[];
  isAnonymous?: boolean;
  verified?: boolean;
  preferences?: Record<string, any>;
  partnerId?: string; 
  comparePassword: (enteredPassword: string) => Promise<boolean>; 
}

const UserSchema = new Schema<IUser>(
  {
    phone: String,
    email: { type: String, unique: true, sparse: true },
    name: String,
    gender: String,
    password: { type: String, select: false }, 
    confirmPassword: String,
    dateOfBirth: String,
    homeAddress: String,
    city: String,
    state: String,
    lga: String,
    userImage: { type: Schema.Types.ObjectId, ref: "Image" },
    roles: { type: [String], default: ["User"] },
    isAnonymous: { type: Boolean, default: false },
    verified: { type: Boolean, default: false },
    preferences: { type: Object, default: {} },
    partnerId: { type: String },
  },
  { timestamps: true }
);

// ----------------------------------------------------------------
// 1. Password Hashing Pre-Save Hook
// ----------------------------------------------------------------
UserSchema.pre('save', async function (next) {
    if (!this.isModified('password') || !this.password) {
        return next();
    }
    
    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        this.confirmPassword = undefined;
        next();
    } catch (error: any) {
        next(error);
    }
});

// ----------------------------------------------------------------
// 2. Schema Method for Password Comparison - ✅ FIXED
// ----------------------------------------------------------------
UserSchema.methods.comparePassword = async function (enteredPassword: string): Promise<boolean> {
    // ✅ Safety check: return false if password doesn't exist
    if (!this.password) {
        console.log('⚠️ comparePassword called but user has no password');
        return false;
    }
    
    try {
        return await bcrypt.compare(enteredPassword, this.password);
    } catch (error) {
        console.error('❌ Password comparison error:', error);
        return false;
    }
};

export const User = mongoose.model<IUser>("User", UserSchema);