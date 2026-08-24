import mongoose, { Document, Schema } from "mongoose";
import { IImage } from "./image";

export interface IDoctor extends Document {
  firstName: string;
  lastName: string;
  email: string;
  passwordHash: string;
  doctorImage?: IImage | mongoose.Types.ObjectId;
  specialization: string;
  licenseNumber: string;
  yearsOfExperience?: number;
  roles?: string[];
  bio?: string;
  profileImage?: string;
  contactNumber?: string;
  availability?: Record<string, any>;
  ratings?: number;
  reviews?: Array<{ userId: string; rating: number; comment: string }>;
  status: "submitted" | "reviewing" | "approved" | "rejected";
  profileComplete: boolean;
  expoPushTokens?: string[];
  fcmTokens?: string[];
  resetPasswordToken?: string;
  resetPasswordExpires?: Date;
  addFcmToken: (token: string) => Promise<void>;
  removeFcmToken: (token: string) => Promise<void>;
  createdAt: Date;
  updatedAt?: Date;
}

const DoctorSchema = new Schema<IDoctor>(
  {
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    doctorImage: { type: Schema.Types.ObjectId, ref: "Image" },
    specialization: { type: String, required: true },
    licenseNumber: { type: String, required: true },
    yearsOfExperience: Number,
    roles: { type: [String], required: false , default: ["Doctor"] },
    bio: String,
    profileImage: String,
    contactNumber: String,
    availability: Object,
    ratings: { type: Number, default: 0 },
    reviews: [
      {
        userId: { type: Schema.Types.ObjectId, ref: "User" },
        rating: Number,
        comment: String,
      },
    ],
    status: {
      type: String,
      enum: ["submitted", "reviewing", "approved", "rejected"],
      default: "submitted",
      required: true,
    },
    profileComplete: { type: Boolean, default: false },
    expoPushTokens: { type: [String], default: [] },
    fcmTokens: { type: [String], default: [] },
    resetPasswordToken: { type: String, select: false },
    resetPasswordExpires: { type: Date, select: false },
  },
  { timestamps: true }
);

DoctorSchema.methods.addFcmToken = async function (token: string) {
  if (!token) return;
  if (!this.fcmTokens) this.fcmTokens = [];
  if (!this.fcmTokens.includes(token)) {
    this.fcmTokens.push(token);
    await this.save();
  }
};

DoctorSchema.methods.removeFcmToken = async function (token: string) {
  if (!this.fcmTokens || !token) return;
  this.fcmTokens = this.fcmTokens.filter((t: string) => t !== token);
  await this.save();
};

export const Doctor = mongoose.model<IDoctor>("Doctor", DoctorSchema);
