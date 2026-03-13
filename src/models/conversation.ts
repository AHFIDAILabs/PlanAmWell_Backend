// models/conversation.ts - Doctor-Patient Chat Room
import mongoose, { Schema, Document, Types } from "mongoose";

export type MessageType = "text" | "image" | "video" | "audio" | "system";
export type MessageStatus = "sent" | "delivered" | "read";

export interface IMessage {
  _id: Types.ObjectId;
  senderId: Types.ObjectId;
  senderType: "User" | "Doctor";
  messageType: MessageType;
  content: string;
  mediaUrl?: string;
  status: MessageStatus;
  createdAt: Date;
  readAt?: Date;
}

export interface IVideoCallRequest {
  _id?: Types.ObjectId;
  requestedBy: Types.ObjectId;
  requestedByType: "User" | "Doctor";
  status: "pending" | "accepted" | "declined" | "expired" | "cancelled";
  requestedAt: Date;
  respondedAt?: Date;
  expiresAt: Date;
}

export interface IConversation extends Document {
  appointmentId: Types.ObjectId;
  participants: {
    userId: Types.ObjectId;
    doctorId: Types.ObjectId;
  };
  messages: IMessage[];
  lastMessage?: IMessage;
  unreadCount: {
    user: number;
    doctor: number;
  };
  
  // Video call consent
  activeVideoRequest?: IVideoCallRequest;
  videoCallHistory: IVideoCallRequest[];
  
  isActive: boolean;
  isPinned: {
    user: boolean;
    doctor: boolean;
  };
  isMuted: {
    user: boolean;
    doctor: boolean;
  };
  
  createdAt: Date;
  updatedAt: Date;
  lastActivityAt: Date;
}

const MessageSchema = new Schema<IMessage>(
  {
    senderId: { type: Schema.Types.ObjectId, required: true, refPath: "senderType" },
    senderType: { type: String, enum: ["User", "Doctor"], required: true },
    messageType: {
      type: String,
      enum: ["text", "image", "video", "audio", "system"],
      default: "text",
    },
    content: { type: String, required: true },
    mediaUrl: String,
    status: {
      type: String,
      enum: ["sent", "delivered", "read"],
      default: "sent",
    },
    readAt: Date,
  },
  { timestamps: true }
);

const VideoCallRequestSchema = new Schema<IVideoCallRequest>(
  {
    requestedBy: { type: Schema.Types.ObjectId, required: true },
    requestedByType: { type: String, enum: ["User", "Doctor"], required: true },
    status: {
      type: String,
      enum: ["pending", "accepted", "declined", "expired", "cancelled"],
      default: "pending",
    },
    requestedAt: { type: Date, default: Date.now },
    respondedAt: Date,
    expiresAt: { type: Date, required: true },
  },
  { _id: true }
);

const ConversationSchema = new Schema<IConversation>(
  {
    appointmentId: {
      type: Schema.Types.ObjectId,
      ref: "Appointment",
      required: true,
      unique: true,
    },
    participants: {
      userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
      doctorId: { type: Schema.Types.ObjectId, ref: "Doctor", required: true },
    },
    messages: [MessageSchema],
    lastMessage: MessageSchema,
    unreadCount: {
      user: { type: Number, default: 0 },
      doctor: { type: Number, default: 0 },
    },
    
    // Video call consent
    activeVideoRequest: VideoCallRequestSchema,
    videoCallHistory: [VideoCallRequestSchema],
    
    isActive: { type: Boolean, default: true },
    isPinned: {
      user: { type: Boolean, default: false },
      doctor: { type: Boolean, default: false },
    },
    isMuted: {
      user: { type: Boolean, default: false },
      doctor: { type: Boolean, default: false },
    },
    lastActivityAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Indexes
ConversationSchema.index({ appointmentId: 1 });
ConversationSchema.index({ "participants.userId": 1, isActive: 1 });
ConversationSchema.index({ "participants.doctorId": 1, isActive: 1 });
ConversationSchema.index({ lastActivityAt: -1 });

// Auto-update lastActivityAt
ConversationSchema.pre("save", function (next) {
  if (this.isModified("messages")) {
    this.lastActivityAt = new Date();
    if (this.messages.length > 0) {
      this.lastMessage = this.messages[this.messages.length - 1];
    }
  }
  next();
});

export const Conversation = mongoose.model<IConversation>(
  "Conversation",
  ConversationSchema
);