import mongoose, { Document, Schema, Types } from "mongoose";
import bcrypt from "bcryptjs";
import { IImage } from "./image";

// --- Extended User Interface ---
export interface IUser extends Document {
  _id: Types.ObjectId;
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
  pseudonym?: string;
  expoPushTokens?: string[];
  fcmTokens?: string[];
  resetPasswordToken?: string;
  resetPasswordExpires?: Date;
  comparePassword: (enteredPassword: string) => Promise<boolean>;
  addExpoPushToken: (token: string) => Promise<void>;
  removeExpoPushToken: (token: string) => Promise<void>;
  addFcmToken: (token: string) => Promise<void>;
  removeFcmToken: (token: string) => Promise<void>;
  createdAt: Date;
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
     roles: { 
      type: [String], // ✅ Changed to array
      enum: ["User", "Admin", "Doctor"], 
      default: ["User"] // ✅ Changed to array
    },
    verified: { type: Boolean, default: false },
    preferences: { type: Object, default: {} },
    partnerId: { type: String },
    pseudonym: { type: String },
    expoPushTokens: { type: [String], default: [] },
    fcmTokens: { type: [String], default: [] },
    resetPasswordToken: { type: String, select: false },
    resetPasswordExpires: { type: Date, select: false },
    createdAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// ----------------------------------------------------------------
// Password Hashing Pre-Save Hook
// ----------------------------------------------------------------
UserSchema.pre("save", async function (next) {
  if (!this.isModified("password") || !this.password) return next();
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
// Schema Method: Compare Password
// ----------------------------------------------------------------
UserSchema.methods.comparePassword = async function (
  enteredPassword: string
): Promise<boolean> {
  if (!this.password) return false;
  try {
    return await bcrypt.compare(enteredPassword, this.password);
  } catch (error) {
    console.error("❌ Password comparison error:", error);
    return false;
  }
};

// Add Expo Push Token
UserSchema.methods.addExpoPushToken = async function (token: string) {
  if (!token) return;
  if (!this.expoPushTokens) this.expoPushTokens = [];
  if (!this.expoPushTokens.includes(token)) {
    this.expoPushTokens.push(token);
    await this.save();
  }
};

// Remove Expo Push Token
UserSchema.methods.removeExpoPushToken = async function (token: string) {
  if (!this.expoPushTokens || !token) return;
  this.expoPushTokens = this.expoPushTokens.filter((t: string) => t !== token);
  await this.save();
};

// Add raw FCM device token (used for data-only "wake the app" call pushes,
// separate from expoPushTokens which go through Expo's relay)
UserSchema.methods.addFcmToken = async function (token: string) {
  if (!token) return;
  if (!this.fcmTokens) this.fcmTokens = [];
  if (!this.fcmTokens.includes(token)) {
    this.fcmTokens.push(token);
    await this.save();
  }
};

// Remove raw FCM device token
UserSchema.methods.removeFcmToken = async function (token: string) {
  if (!this.fcmTokens || !token) return;
  this.fcmTokens = this.fcmTokens.filter((t: string) => t !== token);
  await this.save();
};

export const User = mongoose.model<IUser>("User", UserSchema);
