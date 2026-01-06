// models/Appointment.ts
import mongoose, { Schema, Types, Document } from "mongoose";
import { IDoctor } from "./doctor";

export type AppointmentStatus =
  | "pending" 
  | "confirmed" 
  | "in-progress" 
  | "completed" 
  | "cancelled" 
  | "rejected" 
  | "rescheduled"
  | "expired"
  | "call-ended"
  | "confirmed-upcoming"
  | "about-to-start";

export type CallStatus =
  | "idle"        // no call started
  | "ringing"     // call initiated, waiting for other party
  | "in-progress" // both connected
  | "ended";      // call completed

export type PaymentStatus = "pending" | "paid" | "failed";
export type CallQuality = "excellent" | "good" | "fair" | "poor";
export type CallEndedBy = "Doctor" | "User" | "system";
export type ConsultationType = "video" | "in-person" | "chat" | "audio";

// ✅ NEW: Call attempt tracking
export interface ICallAttempt {
  startedAt: Date;
  endedAt?: Date;
  endReason?: "completed" | "timeout" | "disconnected" | "error" | "cancelled";
  participants: Types.ObjectId[];
  duration?: number;
  quality?: CallQuality;
}

// ✅ NEW: Real-time participant tracking
export interface IActiveParticipant {
  userId: Types.ObjectId;
  joinedAt: Date;
  isActive: boolean;
  lastPing?: Date;
}

export interface IAppointment extends Document {
  userId: Types.ObjectId;
  doctorId: Types.ObjectId | IDoctor;

  scheduledAt: Date;
  proposedAt?: Date;

  duration: number;

  status: AppointmentStatus;
  paymentStatus: PaymentStatus;
  consultationType?: ConsultationType;

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

  // ✅ Call state
  callStatus: CallStatus;
  callChannelName?: string;
  callInitiatedBy?: CallEndedBy;
  callParticipants: Types.ObjectId[];

  // ✅ NEW: Active participant tracking
  activeParticipants: IActiveParticipant[];

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
  expiryWarningSent: boolean;

  // ✅ NEW: Call history
  callAttempts: ICallAttempt[];

  // ✅ NEW: Prevent duplicate notifications
  notificationsSent: {
    reminder?: boolean;
    expiryWarning?: boolean;
    callStarted?: boolean;
    callEnded?: boolean;
  };

  reminderSent: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const CallAttemptSchema = new Schema<ICallAttempt>(
  {
    startedAt: { type: Date, required: true },
    endedAt: Date,
    endReason: {
      type: String,
      enum: ["completed", "timeout", "disconnected", "error", "cancelled"],
    },
    participants: [{ type: Schema.Types.ObjectId, ref: "User" }],
    duration: Number,
    quality: {
      type: String,
      enum: ["excellent", "good", "fair", "poor"],
    },
  },
  { _id: false }
);

const ActiveParticipantSchema = new Schema<IActiveParticipant>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    joinedAt: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
    lastPing: Date,
  },
  { _id: false }
);

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

    // ✅ CALL STATE
    callStatus: {
      type: String,
      enum: ["idle", "ringing", "in-progress", "ended"],
      default: "idle",
    },
    callChannelName: { type: String, default: "" },
    callInitiatedBy: {
      type: String,
      enum: ["Doctor", "User", "system"],
      default: undefined,
    },
    callParticipants: {
      type: [{ type: Schema.Types.ObjectId, ref: "User" }],
      default: [],
    },

    // ✅ NEW: Active participant tracking
    activeParticipants: {
      type: [ActiveParticipantSchema],
      default: [],
    },

    expiryWarningSent: {
      type: Boolean,
      default: false,
    },

    // ✅ Agora metadata
    agoraUidMap: { doctor: Number, user: Number, _id: false },

    callStartedAt: Date,
    callEndedAt: Date,
    callDuration: Number,

    callQuality: {
      type: String,
      enum: ["excellent", "good", "fair", "poor"],
    },
    callEndedBy: { type: String, enum: ["Doctor", "User", "system"] },

    // ✅ NEW: Call history
    callAttempts: {
      type: [CallAttemptSchema],
      default: [],
    },

    // ✅ NEW: Notification tracking
    notificationsSent: {
      reminder: { type: Boolean, default: false },
      expiryWarning: { type: Boolean, default: false },
      callStarted: { type: Boolean, default: false },
      callEnded: { type: Boolean, default: false },
    },

    reminderSent: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// ✅ NEW: Indexes for performance
AppointmentSchema.index({ status: 1, scheduledAt: 1, reminderSent: 1 });
AppointmentSchema.index({ callStatus: 1, callStartedAt: 1 });
AppointmentSchema.index({ doctorId: 1, status: 1 });
AppointmentSchema.index({ userId: 1, status: 1 });

// ✅ NEW: Helper methods
AppointmentSchema.methods.addActiveParticipant = function (userId: string) {
  const participantId = new mongoose.Types.ObjectId(userId);
  const existing = this.activeParticipants.find(
    (p: IActiveParticipant) => p.userId.equals(participantId)
  );

  if (!existing) {
    this.activeParticipants.push({
      userId: participantId,
      joinedAt: new Date(),
      isActive: true,
      lastPing: new Date(),
    });
  } else {
    existing.isActive = true;
    existing.lastPing = new Date();
  }
};

AppointmentSchema.methods.removeActiveParticipant = function (userId: string) {
  const participantId = new mongoose.Types.ObjectId(userId);
  const participant = this.activeParticipants.find(
    (p: IActiveParticipant) => p.userId.equals(participantId)
  );

  if (participant) {
    participant.isActive = false;
  }
};

AppointmentSchema.methods.getActiveParticipantCount = function (): number {
  return this.activeParticipants.filter((p: IActiveParticipant) => p.isActive)
    .length;
};

export const Appointment = mongoose.model<IAppointment>(
  "Appointment",
  AppointmentSchema
);