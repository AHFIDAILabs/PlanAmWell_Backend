import mongoose, { Document, Schema, Types } from "mongoose";

export interface IRefreshToken extends Document {
  token: string;
  userId: Types.ObjectId; // ✅ fixed
  userType: "User" | "Doctor";
  expiresAt: Date;
}

const RefreshTokenSchema = new Schema<IRefreshToken>(
  {
    token: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, refPath: "userType", required: true }, // ✅ added refPath
    userType: { type: String, enum: ["User", "Doctor"], required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

export const RefreshToken = mongoose.model<IRefreshToken>(
  "RefreshToken",
  RefreshTokenSchema
);
