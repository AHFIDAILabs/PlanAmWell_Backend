// models/Appointment.ts
import mongoose, { Schema, Types, Document } from "mongoose";
import { IDoctor } from "./doctor";

export type AppointmentStatus =
  | "pending"
  | "confirmed"
  | "cancelled"
  | "completed"
  | "rejected"
  | "rescheduled"
  | "in-progress";

export type PaymentStatus = "pending" | "paid" | "failed";
export type CallQuality = "excellent" | "good" | "fair" | "poor";
export type CallEndedBy = "Doctor" | "User";
export type consultationType = "video" | "in-person" | "chat" | "audio";

export interface IAppointment extends Document {
  userId: Types.ObjectId;
  doctorId: Types.ObjectId | IDoctor;

  scheduledAt: Date;
  proposedAt?: Date;

  duration: number;                 // ✅ no longer optional

  status: AppointmentStatus;
  paymentStatus: PaymentStatus;
  consultationType?: consultationType;

  reason?: string;
  notes?: string;

  shareUserInfo: boolean;            // ✅ no longer optional

  patientSnapshot?: {
    name?: string;
    email?: string;
    phone?: string;
    gender?: string;
    dateOfBirth?: Date;
    homeAddress?: string;
  };

  // Call metadata (kept flat for now)
  callDuration?: number;
  callQuality?: CallQuality;
  callEndedBy?: CallEndedBy;
  callEndedAt?: Date;

  reminderSent: boolean;

  createdAt: Date;
  updatedAt: Date;
}

const AppointmentSchema = new Schema<IAppointment>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    doctorId: { type: Schema.Types.ObjectId, ref: "Doctor", required: true },

    scheduledAt: { type: Date, required: true },
    proposedAt: { type: Date },

    duration: { type: Number, default: 30 },
    consultationType: { type: String, enum: ["video", "in-person", "chat", "audio"], default: "video" },

    status: {
      type: String,
      enum: [
        "pending",
        "confirmed",
        "cancelled",
        "completed",
        "rejected",
        "rescheduled",
        "in-progress"
      ],
      default: "pending",
    },

    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed"],
      default: "pending",
    },

    reason: { type: String },
    notes: { type: String },

    shareUserInfo: { type: Boolean, default: false },

    patientSnapshot: {
      name: String,
      email: String,
      phone: String,
      gender: String,
      dateOfBirth: Date,
      homeAddress: String,
    },

    callDuration: Number,
    callQuality: { type: String, enum: ["excellent", "good", "fair", "poor"] },
    callEndedBy: { type: String, enum: ["Doctor", "User"] },
    callEndedAt: Date,

    reminderSent: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const Appointment = mongoose.model<IAppointment>(
  "Appointment",
  AppointmentSchema
);
