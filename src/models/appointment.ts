import mongoose, { Document, Schema, Types } from "mongoose";
import { IUser, IDoctor } from "../types"; // your existing types

export interface IAppointment extends Document {
    userId: Types.ObjectId; // ✅ fixed
  doctorId: Types.ObjectId;        // reference to the doctor
  scheduledAt: Date;       // date & time of the appointment
  duration?: number;       // in minutes
  status: "pending" | "confirmed" | "cancelled" | "completed";
  paymentStatus?: "pending" | "paid" | "failed";
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const AppointmentSchema = new Schema<IAppointment>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    doctorId: { type: Schema.Types.ObjectId, ref: "Doctor", required: true },
    scheduledAt: { type: Date, required: true },
    duration: { type: Number, default: 30 },
    status: {
      type: String,
      enum: ["pending", "confirmed", "cancelled", "completed"],
      default: "pending",
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed"],
      default: "pending",
    },
    notes: { type: String },
  },
  { timestamps: true }
);

export const Appointment = mongoose.model<IAppointment>(
  "Appointment",
  AppointmentSchema
);
