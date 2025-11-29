import mongoose, { Document, Schema } from "mongoose";

export interface ISession extends Document {
  userId?: mongoose.Types.ObjectId;
  isAnonymous: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  expiresAt?: Date;
  data?: Record<string, any>; // For storing cart, chat history, preferences
}

const SessionSchema = new Schema<ISession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    isAnonymous: { type: Boolean, default: true },
    expiresAt: { type: Date, default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }, // 7 days
    data: { type: Object, default: {} },
  },
  { timestamps: true }
);

export const Session = mongoose.model<ISession>("Session", SessionSchema);
