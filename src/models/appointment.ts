// models/Appointment.ts
import mongoose, { Schema, Types, Document } from "mongoose";
import { IDoctor } from "./doctor";

export interface IAppointment extends Document {
  userId: Types.ObjectId;
  doctorId: Types.ObjectId | IDoctor;


  scheduledAt: Date;
  proposedAt?: Date;

  duration?: number;

  status:
    | "pending"
    | "confirmed"
    | "cancelled"
    | "completed"
    | "rejected"
    | "rescheduled";

  paymentStatus?: "pending" | "paid" | "failed";

  reason?: string;
  notes?: string;

  shareUserInfo?: boolean;

  patientSnapshot?: {
    name?: string;
    email?: string;
    phone?: string;
    gender?: string;
    dateOfBirth?: Date;
    homeAddress?: string;
  };

  reminderSent?: boolean; // ✨ NEW: Track if 15-min reminder was sent

  createdAt?: Date;
  updatedAt?: Date;
}

const AppointmentSchema = new Schema<IAppointment>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    doctorId: { type: Schema.Types.ObjectId, ref: "Doctor", required: true },

    scheduledAt: { type: Date, required: true },
    proposedAt: { type: Date },

    duration: { type: Number, default: 30 },

    status: {
      type: String,
      enum: [
        "pending",
        "confirmed",
        "cancelled",
        "completed",
        "rejected",
        "rescheduled",
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

    reminderSent: { type: Boolean, default: false }, // ✨ NEW

  },
  { timestamps: true }
);

export const Appointment = mongoose.model<IAppointment>(
  "Appointment",
  AppointmentSchema
);