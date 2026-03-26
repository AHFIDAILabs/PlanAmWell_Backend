// models/AccessRequest.ts
import mongoose, { Schema, Document, Types } from "mongoose";

export type AccessRequestStatus = "pending" | "approved" | "denied" | "expired";

export interface IAccessRequest extends Document {
  patientId:         Types.ObjectId;
  requestingDoctorId: Types.ObjectId;
  appointmentId:     Types.ObjectId;
  status:            AccessRequestStatus;
  requestedAt:       Date;
  respondedAt?:      Date;
  expiresAt:         Date;   // auto-deny after 48h
  notifiedPatient:   boolean;
}

const AccessRequestSchema = new Schema<IAccessRequest>(
  {
    patientId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    requestingDoctorId: {
      type: Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
    },
    appointmentId: {
      type: Schema.Types.ObjectId,
      ref: "Appointment",
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "denied", "expired"],
      default: "pending",
    },
    requestedAt:     { type: Date, default: Date.now },
    respondedAt:     Date,
    expiresAt:       { type: Date, required: true },  // set to requestedAt + 48h
    notifiedPatient: { type: Boolean, default: false },
  },
  { timestamps: true }
);

AccessRequestSchema.index({ patientId: 1, status: 1 });
AccessRequestSchema.index({ requestingDoctorId: 1 });
AccessRequestSchema.index({ appointmentId: 1 }, { unique: true }); // one request per appointment
AccessRequestSchema.index({ expiresAt: 1 });

export const AccessRequest = mongoose.model<IAccessRequest>(
  "AccessRequest",
  AccessRequestSchema
);