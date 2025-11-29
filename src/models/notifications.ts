import mongoose, { Document, Schema } from "mongoose";

export interface INotification extends Document {
  userId: mongoose.Types.ObjectId;
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
  createdAt: Date;
}

const notificationSchema = new Schema<INotification>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  type: {
    type: String,
    enum: ["supplement", "order", "appointment", "article", "system"],
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
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

notificationSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model<INotification>(
  "Notification",
  notificationSchema
);
