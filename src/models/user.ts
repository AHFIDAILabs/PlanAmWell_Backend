import mongoose, { Document, Schema } from "mongoose";
import bcrypt from 'bcryptjs'; // ⬅️ Must import bcryptjs
import { IImage } from "./image";

// --- Extended User Interface ---
// Extend the IUser interface to include the Mongoose methods
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
    // Mongoose methods are usually defined on the Document type, but we include it here
    // for better TypeScript visibility in the controller.
    comparePassword: (enteredPassword: string) => Promise<boolean>; 
}

const UserSchema = new Schema<IUser>(
  {
    phone: String,
    email: { type: String, unique: true, sparse: true },
    name: String,
    gender: String,
    // 💡 Hide password hash from default queries for security
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
// 1. Password Hashing Pre-Save Hook (Ensures password is hashed)
// ----------------------------------------------------------------
UserSchema.pre('save', async function (next) {
    // Only run this function if password was actually modified or is new
    if (!this.isModified('password') || !this.password) {
        return next();
    }
    
    // Hash password
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    
    // Clear confirmPassword field before saving to DB
    this.confirmPassword = undefined;
    
    next();
});

// ----------------------------------------------------------------
// 2. Schema Method for Password Comparison 
// ----------------------------------------------------------------
UserSchema.methods.comparePassword = async function (enteredPassword: string): Promise<boolean> {
    // Note: Because 'password' has 'select: false', you might need to ensure 
    // it's fetched in your login controller: User.findOne({ email }).select('+password');
    
    // bcrypt handles comparing the plaintext password with the hashed password
    return await bcrypt.compare(enteredPassword, this.password!);
};


export const User = mongoose.model<IUser>("User", UserSchema);