import mongoose, { Schema, Types, HydratedDocument } from "mongoose";

export type NotificationOwnerType = "User" | "Doctor" | "Admin";

export interface INotification {
  userId: Types.ObjectId;
  userType: NotificationOwnerType; // dynamic reference
  type: "supplement" | "order" | "appointment" | "article" | "system";
  title: string;
  message: string;
  isRead: boolean;
  metadata?: {
    orderId?: string;
    appointmentId?: string;
    articleId?: string;
    time?: string;
  };
  createdAt?: Date;
}

export type NotificationDocument = HydratedDocument<INotification>;

const notificationSchema = new Schema<INotification>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      required: true,
      refPath: "userType", // dynamic reference to User or Doctor
      index: true,
    },
    userType: {
      type: String,
      enum: ["User", "Doctor", "Admin"],
      required: true,
    },
    type: {
      type: String,
      enum: ["supplement", "order", "appointment", "article", "system", "call_ended", "comment_flagged"],
      required: true,
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    isRead: { type: Boolean, default: false },
    metadata: {
      orderId: String,
      appointmentId: String,
      articleId: String,
      time: String,
      commentId: String,
      reason: String,
      authorId: String,
      authorUsername: String,
      contentPreview: String,
    },
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model<INotification>(
  "Notification",
  notificationSchema
);
