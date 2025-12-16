// models/VideoCall.ts
import mongoose, { Schema, Document, Types } from "mongoose";

export type VideoCallStatus = "ringing" | "in-progress" | "ended";

export interface IVideoCall extends Document {
  appointmentId: Types.ObjectId;
  channelName: string;
  initiatedBy: "Doctor" | "User";
  participants: Types.ObjectId[];
  agoraUidMap: Record<string, number>;
  status: VideoCallStatus;
  startedAt: Date;
  endedAt?: Date;
}

const VideoCallSchema = new Schema<IVideoCall>(
  {
    appointmentId: { type: Schema.Types.ObjectId, ref: "Appointment", required: true },
    channelName: { type: String, required: true },
    initiatedBy: { type: String, enum: ["Doctor", "User"], required: true },
    participants: [{ type: Schema.Types.ObjectId, ref: "User" }],
    agoraUidMap: { type: Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ["ringing", "in-progress", "ended"],
      default: "ringing",
    },
    startedAt: { type: Date, default: Date.now },
    endedAt: Date,
  },
  { timestamps: true }
);

export const VideoCall = mongoose.model<IVideoCall>(
  "VideoCall",
  VideoCallSchema
);
