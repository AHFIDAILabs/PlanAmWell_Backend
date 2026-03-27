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
import {
  uploadToCloudinary,
  uploadDocumentToCloudinary,
} from "../middleware/claudinary";

const storage = multer.memoryStorage();
export const uploadMiddleware = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB limit
}).single("file");

/**
 * Get or Create Conversation
 *
 * RULES:
 * - One conversation per doctor-patient pair, forever. Never create a second one.
 * - isActive is the sole lock/unlock flag.
 * - isActive = false  →  read-only (locked)
 * - isActive = true   →  active (unlocked)
 *
 * Who can change isActive:
 *   → false : endAppointment (doctor clicks "End")
 *   → true  : updateAppointment when doctor confirms a new appointment (auto-unlock)
 *             OR doctor manually unlocks via unlockConversation endpoint
 *
 * This function NEVER changes isActive. It only reads and returns.
 * The frontend reads isActive and renders the correct UI state.
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

    // Fetch appointment and verify access
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

    // ── Step 1: Find by appointmentId (fastest path — new appointment already linked) ──
    let conversation = await Conversation.findOne({
      appointmentId: appointment._id,
    });

    // ── Step 2: Fallback — find by doctor-patient pair (returning patient whose
    //    existing conversation is linked to an older appointmentId) ──────────────
    if (!conversation) {
      conversation = await Conversation.findOne({
        "participants.userId": patientId,
        "participants.doctorId": doctorId,
      });

      if (conversation) {
        // Link this existing conversation to the current appointment so Step 1
        // works on subsequent calls — avoids repeated pair lookups
        appointment.conversationId = conversation._id as mongoose.Types.ObjectId;
        await appointment.save();
        console.log(
          `🔗 Existing conversation ${conversation._id} linked to appointment ${appointmentId}`
        );
      }
    }

    if (conversation) {
      // ── Found: populate and return as-is ─────────────────────────────────────
      // We do NOT touch isActive here under any circumstance.
      // isActive is managed exclusively by:
      //   - endAppointment       → sets false
      //   - updateAppointment    → sets true on new confirmation
      //   - unlockConversation   → sets true on manual unlock
      conversation = await (
        await conversation.populate("participants.userId", "name userImage")
      ).populate("participants.doctorId", "firstName lastName doctorImage");

    } else {
      // ── Not found: first-ever conversation for this doctor-patient pair ───────
      const doctorName = `Dr. ${(appointment.doctorId as any).firstName} ${
        (appointment.doctorId as any).lastName
      }`;

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
      conversation = await (
        await conversation.populate("participants.userId", "name userImage")
      ).populate("participants.doctorId", "firstName lastName doctorImage");

      // Link conversation to appointment
      appointment.conversationId = conversation._id as mongoose.Types.ObjectId;
      await appointment.save();

      console.log(`✅ New conversation created for appointment ${appointmentId}`);
    }

    // ── Reset unread count for the caller (read-side bookkeeping only) ─────────
    const unreadField = role === "Doctor" ? "doctor" : "user";
    if (conversation.unreadCount[unreadField] > 0) {
      conversation.unreadCount[unreadField] = 0;
      await conversation.save();
    }

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
 * Unlock Conversation (Doctor only — manual unlock)
 *
 * Allows the doctor to manually reopen a locked (read-only) conversation
 * without needing a new appointment confirmation to trigger auto-unlock.
 *
 * PATCH /api/v1/chat/conversation/:conversationId/unlock
 */
export const unlockConversation = asyncHandler(
  async (req: Request, res: Response) => {
    const { conversationId } = req.params;
    const userId = req.auth?.id;
    const role = req.auth?.role;

    if (role !== "Doctor") {
      return res.status(403).json({
        success: false,
        message: "Only doctors can unlock conversations.",
      });
    }

    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found.",
      });
    }

    // Verify this doctor is a participant
    if (String(conversation.participants.doctorId) !== userId) {
      return res.status(403).json({
        success: false,
        message: "You are not a participant in this conversation.",
      });
    }

    if (conversation.isActive) {
      // Already unlocked — idempotent, just return success
      return res.status(200).json({
        success: true,
        message: "Conversation is already active.",
        data: { isActive: true },
      });
    }

    // Unlock
    conversation.isActive = true;
    conversation.messages.push({
      _id: new mongoose.Types.ObjectId(),
      senderId: new mongoose.Types.ObjectId(userId),
      senderType: "Doctor",
      messageType: "system",
      content: "Doctor has reopened this conversation.",
      status: "sent",
      createdAt: new Date(),
    } as IMessage);
    conversation.lastActivityAt = new Date();
    await conversation.save();

    console.log(`🔓 Conversation ${conversationId} manually unlocked by doctor ${userId}`);

    res.status(200).json({
      success: true,
      message: "Conversation unlocked.",
      data: { isActive: true },
    });
  }
);

/**
 * Send Message
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
      .populate(
        "participants.doctorId",
        "firstName lastName doctorImage expoPushTokens"
      );

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
      const senderName =
        role === "Doctor"
          ? `Dr. ${(conversation.participants.doctorId as any).firstName}`
          : (conversation.participants.userId as any).name;

      const apptId = String(conversation.appointmentId);
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
 * Get Messages (Paginated)
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

    const messages = conversation.messages
      .slice(
        Math.max(0, totalMessages - skip - Number(limit)),
        totalMessages - skip
      )
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

/**
 * Upload Chat Media
 */
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
        data: { url, fileType, fileName: originalname, mimeType: mimetype },
      });
    } catch (error: any) {
      console.error("[Chat Upload] Failed:", error.message);
      return res.status(500).json({ success: false, message: "Failed to upload file" });
    }
  }
);

/**
 * Mark Messages as Read
 */
export const markAsRead = asyncHandler(
  async (req: Request, res: Response) => {
    const { conversationId } = req.params;
    const userId = req.auth?.id;
    const role = req.auth?.role;

    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }

    const unreadField = role === "Doctor" ? "doctor" : "user";
    conversation.unreadCount[unreadField] = 0;

    const now = new Date();
    conversation.messages.forEach((msg) => {
      if (String(msg.senderId) !== userId && msg.status !== "read") {
        msg.status = "read";
        msg.readAt = now;
      }
    });

    await conversation.save();

    const recipientId =
      role === "Doctor"
        ? String(conversation.participants.userId)
        : String(conversation.participants.doctorId);

    emitMessageRead(conversationId, recipientId);

    res.status(200).json({ success: true, message: "Messages marked as read" });
  }
);

/**
 * Update Typing Indicator
 */
export const updateTyping = asyncHandler(
  async (req: Request, res: Response) => {
    const { conversationId } = req.params;
    const { isTyping } = req.body;
    const role = req.auth?.role;

    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }

    const recipientId =
      role === "Doctor"
        ? String(conversation.participants.userId)
        : String(conversation.participants.doctorId);

    emitTypingIndicator(conversationId, recipientId, isTyping, role!);

    res.status(200).json({ success: true });
  }
);

/**
 * Request Video Call (Consent Required)
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
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }

    if (
      conversation.activeVideoRequest &&
      conversation.activeVideoRequest.status === "pending"
    ) {
      return res.status(400).json({ success: false, message: "A video call request is already pending" });
    }

    const videoRequest = {
      _id: new mongoose.Types.ObjectId(),
      requestedBy: new mongoose.Types.ObjectId(userId),
      requestedByType: role,
      status: "pending" as const,
      requestedAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * 1000),
    };

    conversation.activeVideoRequest = videoRequest;
    await conversation.save();

    const recipientId =
      role === "Doctor"
        ? String(conversation.participants.userId._id)
        : String(conversation.participants.doctorId._id);

    const requesterName =
      role === "Doctor"
        ? `Dr. ${(conversation.participants.doctorId as any).firstName}`
        : (conversation.participants.userId as any).name;

    emitVideoCallRequest(conversationId, recipientId, requesterName, videoRequest._id.toString());

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
        emitVideoCallResponse(conversationId, String(userId), "expired", videoRequest._id.toString());
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
 * Respond to Video Call Request
 */
export const respondToVideoCall = asyncHandler(
  async (req: Request, res: Response) => {
    const { conversationId, requestId } = req.params;
    const { accept } = req.body;

    const conversation = await Conversation.findById(conversationId).populate("appointmentId");

    if (!conversation) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }

    if (
      !conversation.activeVideoRequest ||
      String(conversation.activeVideoRequest._id) !== requestId
    ) {
      return res.status(404).json({ success: false, message: "Video call request not found or expired" });
    }

    if (conversation.activeVideoRequest.status !== "pending") {
      return res.status(400).json({ success: false, message: "Video call request is no longer pending" });
    }

    conversation.activeVideoRequest.status = accept ? "accepted" : "declined";
    conversation.activeVideoRequest.respondedAt = new Date();
    conversation.videoCallHistory.push(conversation.activeVideoRequest);

    const requesterId = String(conversation.activeVideoRequest.requestedBy);
    const responseStatus = conversation.activeVideoRequest.status;
    conversation.activeVideoRequest = undefined;

    await conversation.save();

    emitVideoCallResponse(conversationId, requesterId, responseStatus, requestId);

    res.status(200).json({
      success: true,
      data: {
        accepted: accept,
        appointmentId: (conversation.appointmentId as any)._id,
      },
      message: accept ? "Video call accepted. Redirecting to call..." : "Video call declined",
    });
  }
);

/**
 * Cancel Video Call Request (by requester)
 */
export const cancelVideoCallRequest = asyncHandler(
  async (req: Request, res: Response) => {
    const { conversationId, requestId } = req.params;
    const userId = req.auth?.id;

    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }

    if (
      !conversation.activeVideoRequest ||
      String(conversation.activeVideoRequest._id) !== requestId
    ) {
      return res.status(404).json({ success: false, message: "Video call request not found" });
    }

    if (String(conversation.activeVideoRequest.requestedBy) !== userId) {
      return res.status(403).json({ success: false, message: "Only the requester can cancel the request" });
    }

    if (conversation.activeVideoRequest.status !== "pending") {
      return res.status(400).json({ success: false, message: "Video call request is no longer pending" });
    }

    conversation.activeVideoRequest.status = "cancelled";
    conversation.activeVideoRequest.respondedAt = new Date();
    conversation.videoCallHistory.push(conversation.activeVideoRequest);

    const recipientId =
      conversation.activeVideoRequest.requestedByType === "Doctor"
        ? String(conversation.participants.userId)
        : String(conversation.participants.doctorId);

    conversation.activeVideoRequest = undefined;
    await conversation.save();

    emitVideoCallResponse(conversationId, recipientId, "cancelled", requestId);

    res.status(200).json({ success: true, message: "Video call request cancelled" });
  }
);

/**
 * Get User's Conversations
 */
export const getUserConversations = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.auth?.id;
    const role = req.auth?.role;

    const query =
      role === "Doctor"
        ? { "participants.doctorId": userId }
        : { "participants.userId": userId };

    const conversations = await Conversation.find(query)
      .populate("appointmentId", "_id scheduledAt status callStatus")
      .populate("participants.userId", "name userImage")
      .populate("participants.doctorId", "firstName lastName doctorImage")
      .sort({ lastActivityAt: -1 });

    res.status(200).json({ success: true, data: conversations });
  }
);