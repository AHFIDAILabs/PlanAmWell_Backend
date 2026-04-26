import mongoose, { Schema, Types, HydratedDocument } from "mongoose";

export type NotificationOwnerType = "User" | "Doctor" | "Admin";

export interface INotification {
  userId: Types.ObjectId;
  userType: NotificationOwnerType; // dynamic reference
  type: "supplement" | "order" | "appointment" | "article" | "system" | "new_message" | "chat" | "call_ended" | "comment_flagged";
  title: string;
  message: string;
  isRead: boolean;
  metadata?: {
    patientId?: Types.ObjectId;
    type: "record_access_response" | "record_access_request" | "record_accessed" | "payment_pending"   | "payment_success"
    | "payment_pending"
    | "delivery_update";
    approved?: boolean;
    orderId?: string;
    appointmentId?: string;
    conversationId?: String;
    articleId?: string;
    time?: string;
     status: String,   
  amount?: Number,   
    orderNumber?: String, 
  senderName?: string;
  doctorName?: string;
  patientName?: string;
  scheduledAt?: string;
  otherPartyName?: string;
  requesterName?: string;
  recordId?: string;
  accessRequestId?: string;
  callDuration?: number;
  minutesRemaining?: number;
  autoEnded?: boolean;
  autoJoin?: boolean;
  fromNotification?: boolean;
  expired?: boolean;
  doctorSpecialization?: string;   
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
      enum: ["supplement", "order", "appointment", "article", "system", "call_ended", "comment_flagged", "chat", "new_message"],
      required: true,
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    isRead: { type: Boolean, default: false },
metadata: {
  orderId:        { type: String },
  appointmentId:  { type: String },
  conversationId: { type: String },
  articleId:      { type: String },
  patientId:      { type: String },
  recordId:       { type: String },
  accessRequestId:{ type: String },
  commentId:      { type: String },
  reason:         { type: String },
  authorId:       { type: String },
  authorUsername: { type: String },
  contentPreview: { type: String },
  type:           { type: String },
  approved:       { type: Boolean },
  // ✅ The fields that were missing and causing the crash:
  status:         { type: String },
  amount:         { type: Number },
  orderNumber:    { type: String },
  senderName:     { type: String },
  doctorName:     { type: String },
  patientName:    { type: String },
  scheduledAt:    { type: String },
  otherPartyName: { type: String },
  requesterName:  { type: String },
  callDuration:   { type: Number },
  minutesRemaining:{ type: Number },
  autoEnded:      { type: Boolean },
  autoJoin:       { type: Boolean },
  fromNotification:{ type: Boolean },
  expired:        { type: Boolean },
  doctorSpecialization: { type: String },
},
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model<INotification>(
  "Notification",
  notificationSchema
);
