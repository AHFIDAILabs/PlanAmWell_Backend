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
  bio?: string;
  profileImage?: string;
  contactNumber?: string;
  availability?: Record<string, any>;
  ratings?: number;
  reviews?: Array<{ userId: string; rating: number; comment: string }>;
  status: "submitted" | "reviewing" | "approved" | "rejected";
  expoPushTokens?: string[];
  createdAt: Date;
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
    expoPushTokens: { type: [String], default: [] },
    createdAt: { type: Date },
  },
  { timestamps: true }
);

export const Doctor = mongoose.model<IDoctor>("Doctor", DoctorSchema);
