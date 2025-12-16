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

  export type CallStatus =
  | "idle"        // no call started
  | "ringing"     // call initiated, waiting for other party
  | "in-progress" // both connected
  | "ended";      // call completed


export type PaymentStatus = "pending" | "paid" | "failed";
export type CallQuality = "excellent" | "good" | "fair" | "poor";
export type CallEndedBy = "Doctor" | "User";
export type consultationType = "video" | "in-person" | "chat" | "audio";

export interface IAppointment extends Document {
  userId: Types.ObjectId;
  doctorId: Types.ObjectId | IDoctor;

  scheduledAt: Date;
  proposedAt?: Date;

  duration: number;

  status: AppointmentStatus;
  paymentStatus: PaymentStatus;
  consultationType?: consultationType;

  reason?: string;
  notes?: string;

  shareUserInfo: boolean;

  patientSnapshot?: {
    name?: string;
    email?: string;
    phone?: string;
    gender?: string;
    dateOfBirth?: Date;
    homeAddress?: string;
  };

  // ✅ Call state (NEW)
  callStatus: CallStatus;
  callChannelName?: string;
  callInitiatedBy?: CallEndedBy;
  callParticipants: Types.ObjectId[];

  // ✅ Agora-safe metadata
  agoraUidMap?: {
    doctor?: number;
    user?: number;
  };

  // Call timing & quality
  callStartedAt?: Date;
  callEndedAt?: Date;
  callDuration?: number;
  callQuality?: CallQuality;
  callEndedBy?: CallEndedBy;

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

    consultationType: {
      type: String,
      enum: ["video", "in-person", "chat", "audio"],
      default: "video",
    },

    status: {
      type: String,
      enum: [
        "pending",
        "confirmed",
        "cancelled",
        "completed",
        "rejected",
        "rescheduled",
        "in-progress",
      ],
      default: "pending",
    },

    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed"],
      default: "pending",
    },

    reason: String,
    notes: String,

    shareUserInfo: { type: Boolean, default: false },

    patientSnapshot: {
      name: String,
      email: String,
      phone: String,
      gender: String,
      dateOfBirth: Date,
      homeAddress: String,
    },

    // ✅ CALL STATE (NEW)
    callStatus: {
      type: String,
      enum: ["idle", "ringing", "in-progress", "ended"],
      default: "idle",
    },

    callChannelName: { type: String },

    callInitiatedBy: {
      type: String,
      enum: ["Doctor", "User"],
    },

    callParticipants: [
      { type: Schema.Types.ObjectId, ref: "User" },
    ],

    // ✅ Agora metadata
    agoraUidMap: {
      doctor: Number,
      user: Number,
    },

    callStartedAt: Date,
    callEndedAt: Date,
    callDuration: Number,

    callQuality: {
      type: String,
      enum: ["excellent", "good", "fair", "poor"],
    },

    callEndedBy: {
      type: String,
      enum: ["Doctor", "User"],
    },

    reminderSent: { type: Boolean, default: false },
  },
  { timestamps: true }
);


export const Appointment = mongoose.model<IAppointment>(
  "Appointment",
  AppointmentSchema
);
