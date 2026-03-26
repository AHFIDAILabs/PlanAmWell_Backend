// controllers/chatController.ts
import { Request, Response } from "express";
import asyncHandler from "../middleware/asyncHandler";
import mongoose from "mongoose";
import { Conversation, IMessage } from "../models/conversation";
import { Appointment } from "../models/appointment";
import { User } from "../models/user";
import { Doctor } from "../models/doctor";
import { 
  emitNewMessage, 
  emitTypingIndicator,
  emitMessageRead,
  emitVideoCallRequest,
  emitVideoCallResponse,
} from "../index";
import { NotificationService } from "../services/NotificationService";
import multer from "multer";
import { uploadToCloudinary, uploadDocumentToCloudinary } from "../middleware/claudinary";

const storage = multer.memoryStorage();
export const uploadMiddleware = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB limit
}).single("file");
 

/**
 *  Get or Create Conversation (Auto-created when appointment is confirmed)
 */
export const getOrCreateConversation = asyncHandler(
  async (req: Request, res: Response) => {
    const { appointmentId } = req.params;
    const userId = req.auth?.id;
    const role = req.auth?.role;

    if (!appointmentId || !userId) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    // Fetch appointment and check access
    const appointment = await Appointment.findById(appointmentId)
      .populate("userId", "name userImage email")
      .populate("doctorId", "firstName lastName doctorImage email");

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: "Appointment not found",
      });
    }

    const doctorId = String(
      (appointment.doctorId as any)._id || appointment.doctorId
    );
    const patientId = String(
      (appointment.userId as any)._id || appointment.userId
    );

    if (userId !== doctorId && userId !== patientId) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized: You are not part of this appointment",
      });
    }

    // Try to find existing conversation for this appointment
    let conversation = await Conversation.findOne({
      appointmentId: appointment._id,
      "participants.userId": patientId,
      "participants.doctorId": doctorId,
    });

    if (conversation) {
  // Reactivate conversation if it was inactive
if (!conversation.isActive) {
  // Prevent reactivation if appointment is completed
  if (appointment.status === "completed") {
    return res.status(403).json({
      success: false,
      message: "Chat is locked because the appointment has ended.",
    });
  }

  conversation.isActive = true;
  conversation.lastActivityAt = new Date();
  await conversation.save();
}

      // Populate participants
      conversation = await (await conversation
        .populate("participants.userId", "name userImage"))
        .populate("participants.doctorId", "firstName lastName doctorImage");
    } else {
      // Create new conversation
      const doctorName = `Dr. ${(appointment.doctorId as any).firstName} ${(appointment.doctorId as any).lastName}`;

      conversation = new Conversation({
        appointmentId: appointment._id,
        participants: {
          userId: patientId,
          doctorId: doctorId,
        },
        messages: [
          {
            _id: new mongoose.Types.ObjectId(),
            senderId: new mongoose.Types.ObjectId(doctorId),
            senderType: "Doctor",
            messageType: "system",
            content: `Chat room created. You can now communicate with ${doctorName}.`,
            status: "sent",
            createdAt: new Date(),
          },
        ],
        unreadCount: { user: 0, doctor: 0 },
        isActive: true,
        isPinned: { user: false, doctor: false },
        isMuted: { user: false, doctor: false },
        lastActivityAt: new Date(),
        videoCallHistory: [],
      });

      await conversation.save();

      // Populate participants
      conversation = await (await conversation
        .populate("participants.userId", "name userImage"))
        .populate("participants.doctorId", "firstName lastName doctorImage");

      // Link conversation to appointment
      appointment.conversationId = conversation._id as mongoose.Types.ObjectId;
      await appointment.save();

      console.log(`✅ Conversation created for appointment ${appointmentId}`);
    }

    // Reset unread count for current user
    const unreadField = role === "Doctor" ? "doctor" : "user";
    if (conversation.unreadCount[unreadField] > 0) {
      conversation.unreadCount[unreadField] = 0;
      await conversation.save();
    }

    // Return response
    res.status(200).json({
      success: true,
      data: conversation,
      appointment: {
        id: appointment._id,
        scheduledAt: appointment.scheduledAt,
        status: appointment.status,
        callStatus: appointment.callStatus,
        doctor: appointment.doctorId,
        patient: appointment.userId,
      },
    });
  }
);

/**
 * ✅ Send Message
 */
export const sendMessage = asyncHandler(
  async (req: Request, res: Response) => {
    const { conversationId } = req.params;
    const { content, messageType = "text", mediaUrl } = req.body;
    const userId = req.auth?.id;
    const role = req.auth?.role as "User" | "Doctor";

    if (!conversationId || !content || !userId) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    const conversation = await Conversation.findById(conversationId)
      .populate("participants.userId", "name userImage expoPushTokens")
      .populate("participants.doctorId", "firstName lastName doctorImage expoPushTokens");

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found",
      });
    }

    

    // Verify user is participant
    const doctorId = String(conversation.participants.doctorId._id);
    const patientId = String(conversation.participants.userId._id);

    if (userId !== doctorId && userId !== patientId) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (!conversation.isActive) {
  return res.status(403).json({
    success: false,
    message: "Cannot send messages: this chat is locked.",
  });
}

    // Create message
    const newMessage: IMessage = {
      _id: new mongoose.Types.ObjectId(),
      senderId: new mongoose.Types.ObjectId(userId),
      senderType: role,
      messageType,
      content,
      mediaUrl,
      status: "sent",
      createdAt: new Date(),
    };

    conversation.messages.push(newMessage);
    conversation.lastMessage = newMessage;

    // Increment unread count for recipient
    if (role === "Doctor") {
      conversation.unreadCount.user += 1;
    } else {
      conversation.unreadCount.doctor += 1;
    }

    await conversation.save();

    // Emit real-time event
    const recipientId = role === "Doctor" ? patientId : doctorId;
    emitNewMessage(conversationId, newMessage, recipientId);

    // Send push notification
  try {
  const senderName = role === "Doctor"
    ? `Dr. ${(conversation.participants.doctorId as any).firstName}`
    : (conversation.participants.userId as any).name;

  // appointmentId comes from the conversation document, not from params
  const apptId = String(conversation.appointmentId);
  console.log('[Chat] appointmentId for notification:', apptId);

  await NotificationService.notifyNewMessage(
    recipientId,
    role === "Doctor" ? "User" : "Doctor",  
    senderName,
    content,
    conversationId,
    apptId  
  );
} catch (error) {
  console.error("Failed to send message notification:", error);
}

    res.status(201).json({
      success: true,
      data: newMessage,
    });
  }
);

/**
 * ✅ Get Messages (Paginated)
 */
export const getMessages = asyncHandler(
  async (req: Request, res: Response) => {
    const { conversationId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const userId = req.auth?.id;

    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found",
      });
    }

    // Verify access
    const doctorId = String(conversation.participants.doctorId);
    const patientId = String(conversation.participants.userId);

    if (userId !== doctorId && userId !== patientId) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const skip = (Number(page) - 1) * Number(limit);
    const totalMessages = conversation.messages.length;
    
    // Get messages in reverse order (newest first) with pagination
    const messages = conversation.messages
      .slice(Math.max(0, totalMessages - skip - Number(limit)), totalMessages - skip)
      .reverse();

    res.status(200).json({
      success: true,
      data: {
        messages,
        total: totalMessages,
        page: Number(page),
        limit: Number(limit),
        hasMore: skip + Number(limit) < totalMessages,
      },
    });
  }
);


export const uploadChatMedia = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.auth?.id;
 
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
 
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file provided" });
    }
 
    const { buffer, mimetype, originalname } = req.file;
    const isImage = mimetype.startsWith("image/");
    const isDocument = !isImage; // pdf, docx, etc.
 
    try {
      let url = "";
      let fileType: "image" | "document" = "image";
 
      if (isImage) {
        const result = await uploadToCloudinary(buffer, "chat/images");
        url = result.secure_url;
        fileType = "image";
      } else {
        const result = await uploadDocumentToCloudinary(buffer, "chat/documents", mimetype);
        url = result.fileUrl;
        fileType = "document";
      }
 
      return res.status(200).json({
        success: true,
        data: {
          url,
          fileType,
          fileName: originalname,
          mimeType: mimetype,
        },
      });
    } catch (error: any) {
      console.error("[Chat Upload] Failed:", error.message);
      return res.status(500).json({
        success: false,
        message: "Failed to upload file",
      });
    }
  }
);

/**
 * ✅ Mark Messages as Read
 */
export const markAsRead = asyncHandler(
  async (req: Request, res: Response) => {
    const { conversationId } = req.params;
    const userId = req.auth?.id;
    const role = req.auth?.role;

    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found",
      });
    }

    // Reset unread count
    const unreadField = role === "Doctor" ? "doctor" : "user";
    conversation.unreadCount[unreadField] = 0;

    // Mark messages as read
    const now = new Date();
    conversation.messages.forEach((msg) => {
      if (String(msg.senderId) !== userId && msg.status !== "read") {
        msg.status = "read";
        msg.readAt = now;
      }
    });

    await conversation.save();

    // Emit read receipt
    const recipientId =
      role === "Doctor"
        ? String(conversation.participants.userId)
        : String(conversation.participants.doctorId);
    
    emitMessageRead(conversationId, recipientId);

    res.status(200).json({
      success: true,
      message: "Messages marked as read",
    });
  }
);

/**
 * ✅ Update Typing Indicator
 */
export const updateTyping = asyncHandler(
  async (req: Request, res: Response) => {
    const { conversationId } = req.params;
    const { isTyping } = req.body;
    const userId = req.auth?.id;
    const role = req.auth?.role;

    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found",
      });
    }

    // Emit typing event to recipient
    const recipientId =
      role === "Doctor"
        ? String(conversation.participants.userId)
        : String(conversation.participants.doctorId);

    emitTypingIndicator(conversationId, recipientId, isTyping, role!);

    res.status(200).json({
      success: true,
    });
  }
);

/**
 * ✅ Request Video Call (Consent Required)
 */
export const requestVideoCall = asyncHandler(
  async (req: Request, res: Response) => {
    const { conversationId } = req.params;
    const userId = req.auth?.id;
    const role = req.auth?.role as "User" | "Doctor";

    const conversation = await Conversation.findById(conversationId)
      .populate("appointmentId")
      .populate("participants.userId", "name expoPushTokens")
      .populate("participants.doctorId", "firstName lastName expoPushTokens");

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found",
      });
    }

    // Check if there's already an active request
    if (
      conversation.activeVideoRequest &&
      conversation.activeVideoRequest.status === "pending"
    ) {
      return res.status(400).json({
        success: false,
        message: "A video call request is already pending",
      });
    }

    // Create video call request
    const videoRequest = {
      _id: new mongoose.Types.ObjectId(),
      requestedBy: new mongoose.Types.ObjectId(userId),
      requestedByType: role,
      status: "pending" as const,
      requestedAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * 1000), // 60 seconds
    };

    conversation.activeVideoRequest = videoRequest;
    await conversation.save();

    // Emit to recipient
    const recipientId =
      role === "Doctor"
        ? String(conversation.participants.userId._id)
        : String(conversation.participants.doctorId._id);

    const requesterName =
      role === "Doctor"
        ? `Dr. ${(conversation.participants.doctorId as any).firstName}`
        : (conversation.participants.userId as any).name;

    emitVideoCallRequest(
      conversationId,
      recipientId,
      requesterName,
      videoRequest._id.toString()
    );

    // Send push notification
    try {
      await NotificationService.notifyVideoCallRequest(
        recipientId,
        role === "Doctor" ? "User" : "Doctor",
        requesterName,
        conversationId
      );
    } catch (error) {
      console.error("Failed to send video call request notification:", error);
    }

    // Auto-expire after 60 seconds
    setTimeout(async () => {
      const conv = await Conversation.findById(conversationId);
      if (
        conv?.activeVideoRequest &&
        conv.activeVideoRequest.status === "pending" &&
        String(conv.activeVideoRequest._id) === String(videoRequest._id)
      ) {
        conv.activeVideoRequest.status = "expired";
        conv.videoCallHistory.push(conv.activeVideoRequest);
        conv.activeVideoRequest = undefined;
        await conv.save();

        emitVideoCallResponse(
          conversationId,
          String(userId),
          "expired",
          videoRequest._id.toString()
        );
      }
    }, 60000);

    res.status(200).json({
      success: true,
      data: conversation.activeVideoRequest,
      message: "Video call request sent",
    });
  }
);

/**
 * ✅ Respond to Video Call Request
 */
export const respondToVideoCall = asyncHandler(
  async (req: Request, res: Response) => {
    const { conversationId, requestId } = req.params;
    const { accept } = req.body; // true or false
    const userId = req.auth?.id;

    const conversation = await Conversation.findById(conversationId)
      .populate("appointmentId");

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found",
      });
    }

    if (
      !conversation.activeVideoRequest ||
      String(conversation.activeVideoRequest._id) !== requestId
    ) {
      return res.status(404).json({
        success: false,
        message: "Video call request not found or expired",
      });
    }

    if (conversation.activeVideoRequest.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: "Video call request is no longer pending",
      });
    }

    // Update request status
    conversation.activeVideoRequest.status = accept ? "accepted" : "declined";
    conversation.activeVideoRequest.respondedAt = new Date();
    conversation.videoCallHistory.push(conversation.activeVideoRequest);

    const requesterId = String(conversation.activeVideoRequest.requestedBy);
    
    // Clear active request
    const responseStatus = conversation.activeVideoRequest.status;
    conversation.activeVideoRequest = undefined;
    
    await conversation.save();

    // Emit response to requester
    emitVideoCallResponse(conversationId, requesterId, responseStatus, requestId);

    res.status(200).json({
      success: true,
      data: {
        accepted: accept,
        appointmentId: (conversation.appointmentId as any)._id,
      },
      message: accept
        ? "Video call accepted. Redirecting to call..."
        : "Video call declined",
    });
  }
);

/**
 * ✅ Cancel Video Call Request (by requester)
 */
export const cancelVideoCallRequest = asyncHandler(
  async (req: Request, res: Response) => {
    const { conversationId, requestId } = req.params;
    const userId = req.auth?.id;

    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found",
      });
    }

    if (
      !conversation.activeVideoRequest ||
      String(conversation.activeVideoRequest._id) !== requestId
    ) {
      return res.status(404).json({
        success: false,
        message: "Video call request not found",
      });
    }

    // Verify requester is the one cancelling
    if (String(conversation.activeVideoRequest.requestedBy) !== userId) {
      return res.status(403).json({
        success: false,
        message: "Only the requester can cancel the request",
      });
    }

    if (conversation.activeVideoRequest.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: "Video call request is no longer pending",
      });
    }

    // Cancel request
    conversation.activeVideoRequest.status = "cancelled";
    conversation.activeVideoRequest.respondedAt = new Date();
    conversation.videoCallHistory.push(conversation.activeVideoRequest);

    const recipientId =
      conversation.activeVideoRequest.requestedByType === "Doctor"
        ? String(conversation.participants.userId)
        : String(conversation.participants.doctorId);

    conversation.activeVideoRequest = undefined;
    await conversation.save();

    // Notify recipient
    emitVideoCallResponse(conversationId, recipientId, "cancelled", requestId);

    res.status(200).json({
      success: true,
      message: "Video call request cancelled",
    });
  }
);

/**
 * ✅ Get User's Conversations
 */
export const getUserConversations = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.auth?.id;
    const role = req.auth?.role;

    const query =
      role === "Doctor"
        ? { "participants.doctorId": userId }
        : { "participants.userId": userId};

    const conversations = await Conversation.find(query)
      .populate("appointmentId", "_id scheduledAt status callStatus")
      .populate("participants.userId", "name userImage")
      .populate("participants.doctorId", "firstName lastName doctorImage")
      .sort({ lastActivityAt: -1 });

    res.status(200).json({
      success: true,
      data: conversations,
    });
  }
);