import mongoose, { Schema, Types, HydratedDocument } from "mongoose";

export type NotificationOwnerType = "User" | "Doctor" | "Admin";

export interface INotification {
  userId: Types.ObjectId;
  userType: NotificationOwnerType;
  type:
    | "supplement"
    | "order"
    | "appointment"
    | "article"
    | "system"
    | "new_message"
    | "chat"
    | "call_ended"
    | "comment_flagged";
  title: string;
  message: string;
  isRead: boolean;
  metadata?: {
    // IDs
    orderId?: string;
    appointmentId?: string;
    conversationId?: string;
    articleId?: string;
    patientId?: string;
    recordId?: string;
    accessRequestId?: string;
    commentId?: string;
    authorId?: string;

    // Discriminator — optional because most notifications don't set it
    type?:
      | "record_access_response"
      | "record_access_request"
      | "record_accessed"
      | "payment_pending"
      | "payment_success"
      | "delivery_update"
      | "video_call_request"
      | "reminder";

    // People
    doctorName?: string;
    patientName?: string;
    otherPartyName?: string;
    senderName?: string;
    requesterName?: string;
    doctorSpecialization?: string;
    authorUsername?: string;

    // Appointment
    scheduledAt?: string;
    status?: string;
    reason?: string;

    // Orders / payments
    amount?: number;
    orderNumber?: string;

    // Call
    callDuration?: number;
    minutesRemaining?: number;
    autoEnded?: boolean;
    autoJoin?: boolean;
    fromNotification?: boolean;

    // Misc
    approved?: boolean;
    expired?: boolean;
    time?: string;
    contentPreview?: string;
  };
  createdAt?: Date;
}

export type NotificationDocument = HydratedDocument<INotification>;

const notificationSchema = new Schema<INotification>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      required: true,
      refPath: "userType",
      index: true,
    },
    userType: {
      type: String,
      enum: ["User", "Doctor", "Admin"],
      required: true,
    },
    type: {
      type: String,
      enum: [
        "supplement",
        "order",
        "appointment",
        "article",
        "system",
        "call_ended",
        "comment_flagged",
        "chat",
        "new_message",
      ],
      required: true,
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    isRead: { type: Boolean, default: false },
    metadata: {
      orderId:          { type: String },
      appointmentId:    { type: String },
      conversationId:   { type: String },
      articleId:        { type: String },
      patientId:        { type: String },
      recordId:         { type: String },
      accessRequestId:  { type: String },
      commentId:        { type: String },
      reason:           { type: String },
      authorId:         { type: String },
      authorUsername:   { type: String },
      contentPreview:   { type: String },
      type:             { type: String },
      approved:         { type: Boolean },
      status:           { type: String },
      amount:           { type: Number },
      orderNumber:      { type: String },
      senderName:       { type: String },
      doctorName:       { type: String },
      patientName:      { type: String },
      scheduledAt:      { type: String },
      otherPartyName:   { type: String },
      requesterName:    { type: String },
      callDuration:     { type: Number },
      minutesRemaining: { type: Number },
      autoEnded:        { type: Boolean },
      autoJoin:         { type: Boolean },
      fromNotification: { type: Boolean },
      expired:          { type: Boolean },
      doctorSpecialization: { type: String },
      time:             { type: String },
    },
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model<INotification>("Notification", notificationSchema);