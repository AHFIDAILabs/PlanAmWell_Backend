// controllers/videoCallController.ts
import { Request, Response } from "express";
import asyncHandler from "../middleware/asyncHandler";
import mongoose from "mongoose";
import { Appointment } from "../models/appointment";
import { NotificationService } from "../services/NotificationService";
import { emitRejoinCallAlert, emitCallEnded, emitCallRinging } from "../index";
import { sendIncomingCallPushNotification } from "../util/sendPushNotification";

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN RULE:
//   Ending a VIDEO CALL  → sets callStatus = 'ended', appointment.status stays
//                          'in-progress' or 'confirmed'. The appointment remains
//                          open so the doctor and patient can rejoin if needed.
//
//   Ending an APPOINTMENT → only the doctor's explicit "End Appointment" button
//                           (appointmentController.endAppointment) sets
//                           appointment.status = 'completed'.
//
//   The 48-hour safety net (autoEndExpiredCalls) also only ends the CALL,
//   it never completes the appointment — that still requires the doctor.
// ─────────────────────────────────────────────────────────────────────────────

const extractId = (field: any): string => {
  if (!field) return "";
  if (typeof field === "string") return field;
  if (typeof field === "object" && field._id) return String(field._id);
  return String(field);
};

// ─────────────────────────────────────────────────────────────────────────────
// Start / Join Video Call Session
// Returns session info needed by the client to initiate WebRTC signaling.
// No Agora token is generated — peer connection is established via Socket.IO.
// ─────────────────────────────────────────────────────────────────────────────

export const generateVideoToken = asyncHandler(
  async (req: Request, res: Response) => {
    const { appointmentId } = req.body;
    const userId = req.auth?.id;
    const role   = req.auth?.role;

    if (!appointmentId || !userId || !role) {
      return res.status(400).json({
        success: false,
        message: "Invalid request: Missing required fields",
      });
    }

    let appointment = await Appointment.findById(appointmentId)
      .populate("doctorId", "firstName lastName doctorImage email contactNumber licenseNumber")
      .populate("userId",   "name userImage email phone firstName lastName");

    if (!appointment) {
      return res.status(404).json({ success: false, message: "Appointment not found" });
    }

    const doctorId  = extractId(appointment.doctorId);
    const patientId = extractId(appointment.userId);

    if (![doctorId, patientId].includes(userId)) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized: You are not part of this appointment",
      });
    }

    if (appointment.status === "cancelled") {
      return res.status(400).json({ success: false, message: "This appointment has been cancelled" });
    }

    // Only permanently block when the doctor explicitly ended the appointment.
    // System-auto-expired (callEndedBy = "system") and never-called "completed"
    // appointments are reset below so a new call can begin.
    if (appointment.status === "completed" && appointment.callEndedBy === "Doctor") {
      return res.status(400).json({
        success: false,
        message: "This appointment has been ended by the doctor and cannot be rejoined",
      });
    }

    // Reset any ended/expired call state so a fresh call can be established.
    // This handles: system-auto-expired, call dropped before fully starting,
    // or any case where callStatus="ended" but the appointment is still usable.
    if (appointment.callStatus === "ended" || appointment.status === "completed") {
      console.log(`🔄 Resetting call state for appointment ${appointmentId} (status=${appointment.status}, callEndedBy=${appointment.callEndedBy})`);
      appointment.callStatus       = "idle";
      appointment.callParticipants = [];
      await appointment.save();
    }

    // 15-min window check
    const appointmentTime = new Date(appointment.scheduledAt);
    const now             = new Date();
    const minutesDiff     = (appointmentTime.getTime() - now.getTime()) / (1000 * 60);

    if (minutesDiff > 15) {
      return res.status(400).json({
        success: false,
        message: `Call can only be joined within 15 minutes of scheduled time. Please wait ${Math.floor(minutesDiff - 15)} more minutes.`,
        minutesUntilAvailable: Math.floor(minutesDiff - 15),
      });
    }

    const isDoctor            = role === "Doctor";
    const participantObjectId = new mongoose.Types.ObjectId(userId);
    const recipientUserId     = isDoctor ? patientId : doctorId;
    const callerName          = isDoctor
      ? `Dr. ${(appointment.doctorId as any).firstName} ${(appointment.doctorId as any).lastName}`
      : ((appointment.userId as any).firstName || (appointment.userId as any).name);

    // ── Initiate call (atomic) ────────────────────────────────────────────────
    if (!appointment.callStatus || appointment.callStatus === "idle") {
      // Resolve the conversation for this appointment.
      // Priority 1: use the conversationId stored on the appointment itself —
      //   this is set when the doctor confirms, and is the only reliable link
      //   for returning patients whose conversation still has the OLD appointmentId.
      // Priority 2: fall back to appointmentId field lookup (first-time patients
      //   whose conversation was just created and shares the same appointmentId).
      const Conversation = require("../models/conversation").default;
      let conversation = appointment.conversationId
        ? await Conversation.findById(appointment.conversationId)
        : null;
      if (!conversation) {
        conversation = await Conversation.findOne({ appointmentId });
      }

      const updatedAppointment = await Appointment.findOneAndUpdate(
        { _id: appointmentId, callStatus: { $in: ["idle", null] } },
        {
          $set: {
            callStatus:      "ringing",
            callInitiatedBy: role,
            callChannelName: `appt_${appointmentId}`,
            status:          "in-progress",
          },
          $addToSet: { callParticipants: participantObjectId },
        },
        { new: true }
      )
        .populate("doctorId", "firstName lastName doctorImage")
        .populate("userId",   "name userImage firstName lastName");

      if (updatedAppointment) {
        appointment = updatedAppointment;

        try {
          const callerImage = isDoctor
            ? (appointment.doctorId as any).doctorImage
            : (appointment.userId  as any).userImage;

       sendIncomingCallPushNotification(recipientUserId, {
  appointmentId: appointmentId.toString(),
  callerName,
  callerImage,
  callerType:  role,
  channelName: appointment.callChannelName || `appt_${appointmentId}`,
  conversationId: conversation?._id?.toString(),
  videoRequestId: conversation?.activeVideoRequest?._id?.toString(),
}).catch((err) =>
  console.error("⚠️ Push notification failed (non-fatal):", err.message)
);

          emitCallRinging(appointmentId.toString(), role);

        NotificationService.notifyCallStarted(
  recipientUserId,
  isDoctor ? "User" : "Doctor",
  appointmentId.toString(),
  callerName
).catch((err) =>
  console.error("⚠️ Notification failed (non-fatal):", err.message)
);
        } catch (notifError) {
          console.error("⚠️ Failed to send call notification:", notifError);
        }
      } else {
        // Race condition — someone else initiated first, reload
        appointment = await Appointment.findById(appointmentId)
          .populate("doctorId", "firstName lastName doctorImage")
          .populate("userId",   "name userImage firstName lastName") as any;

        if (!appointment) {
          return res.status(404).json({ success: false, message: "Appointment not found after race condition" });
        }
      }
    }

    // ── Second participant joins ───────────────────────────────────────────────
    if (
      appointment.callStatus === "ringing" &&
      !appointment.callParticipants.some((id) => id.equals(participantObjectId))
    ) {
      appointment.callParticipants.push(participantObjectId);
      appointment.callStatus    = "in-progress";
      appointment.callStartedAt = new Date();
      await appointment.save();

      try {
        emitRejoinCallAlert(isDoctor ? patientId : doctorId, appointmentId.toString(), callerName);
      } catch (e) {
        console.error("⚠️ Failed to send rejoin alert:", e);
      }
    // ── Rejoin in-progress call ────────────────────────────────────────────────
    // else if prevents the ringing→in-progress block from immediately triggering this
    } else if (appointment.callStatus === "in-progress") {
      if (!appointment.callParticipants.some((id) => id.equals(participantObjectId))) {
        appointment.callParticipants.push(participantObjectId);
      }
      await appointment.save();

      try {
        emitRejoinCallAlert(isDoctor ? patientId : doctorId, appointmentId.toString(), callerName);
      } catch (e) {
        console.error("⚠️ Failed to send rejoin alert:", e);
      }
    }

    const channelName = appointment.callChannelName || `appt_${appointmentId}`;

    return res.status(200).json({
      success: true,
      data: {
        channelName,
        callStatus:       appointment.callStatus,
        participantCount: appointment.callParticipants.length,
        isInitiator:      appointment.callInitiatedBy === role,
        doctorName:       `Dr. ${(appointment.doctorId as any).firstName} ${(appointment.doctorId as any).lastName}`,
        patientName:      (appointment.userId as any).firstName || (appointment.userId as any).name,
      },
      message: "Call session ready",
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Confirm Call Join
// ─────────────────────────────────────────────────────────────────────────────

export const confirmCallJoin = asyncHandler(async (req: Request, res: Response) => {
  const { appointmentId } = req.body;
  const userId = req.auth?.id;

  if (!appointmentId || !userId) {
    return res.status(400).json({ success: false, message: "Missing required fields" });
  }

  const appointment = await Appointment.findById(appointmentId)
    .populate("doctorId", "firstName lastName doctorImage")
    .populate("userId",   "name userImage");

  if (!appointment) {
    return res.status(404).json({ success: false, message: "Appointment not found" });
  }

  const doctorId  = extractId(appointment.doctorId);
  const patientId = extractId(appointment.userId);

  if (![doctorId, patientId].includes(userId)) {
    return res.status(403).json({ success: false, message: "Unauthorized" });
  }

  (appointment as any).addActiveParticipant(userId);

  const activeCount = (appointment as any).getActiveParticipantCount();

  if (appointment.callStatus === "ringing" && activeCount === 2) {
    appointment.callStatus    = "in-progress";
    appointment.callStartedAt = new Date();
    appointment.callAttempts.push({
      startedAt:    new Date(),
      participants: [
        new mongoose.Types.ObjectId(doctorId),
        new mongoose.Types.ObjectId(patientId),
      ],
    });
  }

  await appointment.save();

  res.json({
    success: true,
    data: {
      callStatus:        appointment.callStatus,
      activeParticipants: activeCount,
      callStartedAt:     appointment.callStartedAt,
    },
    message: "Call join confirmed",
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Participant Heartbeat
// ─────────────────────────────────────────────────────────────────────────────

export const updateParticipantHeartbeat = asyncHandler(async (req: Request, res: Response) => {
  const { appointmentId } = req.body;
  const userId = req.auth?.id;

  if (!appointmentId || !userId) {
    return res.status(400).json({ success: false, message: "Missing required fields" });
  }

  const appointment = await Appointment.findById(appointmentId);
  if (!appointment) {
    return res.status(404).json({ success: false, message: "Appointment not found" });
  }

  const participant = appointment.activeParticipants.find((p) =>
    p.userId.equals(new mongoose.Types.ObjectId(userId))
  );

  if (participant) {
    participant.lastPing = new Date();
    await appointment.save();
  }

  res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Handle Call Disconnect
// ─────────────────────────────────────────────────────────────────────────────

export const handleCallDisconnect = asyncHandler(async (req: Request, res: Response) => {
  const { appointmentId } = req.body;
  const userId = req.auth?.id;
  const role   = req.auth?.role;

  if (!appointmentId || !userId) {
    return res.status(400).json({ success: false, message: "Missing required fields" });
  }

  const appointment = await Appointment.findById(appointmentId)
    .populate("doctorId", "firstName lastName doctorImage")
    .populate("userId",   "name userImage");

  if (!appointment) {
    return res.status(404).json({ success: false, message: "Appointment not found" });
  }

  console.log(`🔌 ${role} disconnecting from call ${appointmentId}`);

  (appointment as any).removeActiveParticipant(userId);

  const activeCount = (appointment as any).getActiveParticipantCount();

  if (activeCount === 0 && appointment.callStatus === "in-progress") {
    const callDuration = appointment.callStartedAt
      ? Math.floor((Date.now() - appointment.callStartedAt.getTime()) / 1000)
      : 0;

    if (callDuration > 30) {
      console.log(`⏹️ Both participants left — ending CALL only (appointment remains open)`);

      appointment.callStatus  = "ended";
      appointment.callEndedAt = new Date();
      appointment.callEndedBy = "system";
      appointment.callDuration = callDuration;

      const lastAttempt = appointment.callAttempts[appointment.callAttempts.length - 1];
      if (lastAttempt && !lastAttempt.endedAt) {
        lastAttempt.endedAt   = new Date();
        lastAttempt.endReason = "disconnected";
        lastAttempt.duration  = callDuration;
      }

      emitCallEnded("system", appointmentId.toString(), callDuration);
    } else {
      console.log(`⏳ Call too short (${callDuration}s) — allowing reconnection`);
    }
  }

  await appointment.save();

  res.json({
    success: true,
    data: {
      callStatus:        appointment.callStatus,
      activeParticipants: activeCount,
      callEnded:         appointment.callStatus === "ended",
      appointmentStatus: appointment.status,
    },
    message: "Disconnect handled",
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// End Video Call
// ─────────────────────────────────────────────────────────────────────────────

export const endVideoCall = asyncHandler(async (req: Request, res: Response) => {
  const { appointmentId, callDuration, callQuality } = req.body;
  const userId = req.auth?.id;
  const role   = req.auth?.role;

  const appointment = await Appointment.findById(appointmentId)
    .populate("doctorId", "firstName lastName doctorImage")
    .populate("userId",   "name userImage");

  if (!appointment) {
    return res.status(404).json({ success: false, message: "Appointment not found" });
  }

  if (appointment.callStatus === "ended") {
    return res.json({
      success: true,
      message: "Call already ended",
      data:    { appointmentStatus: appointment.status },
    });
  }

  console.log(`🛑 ${role} ending CALL for appointment ${appointmentId} — appointment stays open`);

  const finalDuration = callDuration ||
    (appointment.callStartedAt
      ? Math.floor((Date.now() - appointment.callStartedAt.getTime()) / 1000)
      : 0);

  appointment.callStatus   = "ended";
  appointment.callEndedAt  = new Date();
  appointment.callEndedBy  = role as any;
  appointment.callDuration = finalDuration;

  if (callQuality) appointment.callQuality = callQuality;

  const lastAttempt = appointment.callAttempts[appointment.callAttempts.length - 1];
  if (lastAttempt && !lastAttempt.endedAt) {
    lastAttempt.endedAt   = new Date();
    lastAttempt.endReason = "completed";
    lastAttempt.duration  = finalDuration;
    lastAttempt.quality   = callQuality;
  }

  await appointment.save();

  emitCallEnded(userId!, appointmentId.toString(), finalDuration);

  res.json({
    success: true,
    message: "Call ended. The appointment remains open — doctor can end it when ready.",
    data: {
      appointmentId:     appointment._id,
      callDuration:      finalDuration,
      callQuality:       appointment.callQuality,
      endedBy:           role,
      endedAt:           appointment.callEndedAt,
      appointmentStatus: appointment.status,
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Get Call Status
// ─────────────────────────────────────────────────────────────────────────────

export const getCallStatus = asyncHandler(async (req: Request, res: Response) => {
  const { appointmentId } = req.params;
  const userId = req.auth?.id;
  const role   = req.auth?.role;

  const appointment = await Appointment.findById(appointmentId)
    .populate("doctorId", "firstName lastName doctorImage")
    .populate("userId",   "name userImage");

  if (!appointment) {
    return res.status(404).json({ success: false, message: "Appointment not found" });
  }

  const doctorId  = extractId(appointment.doctorId);
  const patientId = extractId(appointment.userId);

  if (
    (role === "Doctor" && doctorId  !== userId) ||
    (role === "User"   && patientId !== userId)
  ) {
    return res.status(403).json({ success: false, message: "Unauthorized" });
  }

  const now        = new Date();
  const scheduled  = new Date(appointment.scheduledAt);
  const diffMinutes = Math.floor((scheduled.getTime() - now.getTime()) / 60000);

  const canJoinNow =
    appointment.status !== "completed" &&
    diffMinutes <= 15;

  res.json({
    success: true,
    data: {
      appointmentId:      appointment._id,
      status:             appointment.status,
      callStatus:         appointment.callStatus,
      isActive:           appointment.callStatus === "ringing" || appointment.callStatus === "in-progress",
      canJoin:            canJoinNow,
      canRejoin:          appointment.status !== "completed" && appointment.callStatus === "ended",
      minutesUntilCall:   diffMinutes,
      minutesUntilCanJoin: Math.max(0, diffMinutes - 15),
      channelName:        appointment.callChannelName,
      activeParticipants: (appointment as any).getActiveParticipantCount(),
      totalParticipants:  appointment.callParticipants.length,
      callStartedAt:      appointment.callStartedAt,
      callDuration:       appointment.callDuration,
      doctorName:         `Dr. ${(appointment.doctorId as any).firstName} ${(appointment.doctorId as any).lastName}`,
      patientName:        (appointment.userId as any).firstName || (appointment.userId as any).name,
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Decline Incoming Call
// Called by the recipient when they dismiss the IncomingCallScreen without
// joining.  Resets callStatus to idle and notifies the initiator via socket.
// ─────────────────────────────────────────────────────────────────────────────

export const declineCall = asyncHandler(async (req: Request, res: Response) => {
  const { appointmentId } = req.body;
  const userId = req.auth?.id;

  if (!appointmentId || !userId) {
    return res.status(400).json({ success: false, message: "Missing required fields" });
  }

  const appointment = await Appointment.findById(appointmentId);
  if (!appointment) {
    return res.status(404).json({ success: false, message: "Appointment not found" });
  }

  if (appointment.callStatus !== "ringing") {
    return res.json({ success: true, message: "Call already handled" });
  }

  appointment.callStatus      = "idle";
  appointment.callParticipants = [];
  await appointment.save();

  // Notify the appointment room — the initiator is waiting there
  const { io } = require("../index");
  io.to(`appointment:${appointmentId}`).emit("call-declined", {
    appointmentId,
    declinedBy: userId,
    timestamp: new Date().toISOString(),
  });

  console.log(`📵 Call declined for appointment ${appointmentId} by user ${userId}`);

  res.json({ success: true, message: "Call declined" });
});

// ─────────────────────────────────────────────────────────────────────────────
// Report Call Issue
// ─────────────────────────────────────────────────────────────────────────────

export const reportCallIssue = asyncHandler(async (req: Request, res: Response) => {
  const { appointmentId, issueType, description } = req.body;
  const userId = req.auth?.id;

  if (!appointmentId || !issueType) {
    return res.status(400).json({ success: false, message: "Appointment ID and issue type are required" });
  }

  const appointment = await Appointment.findById(appointmentId);
  if (!appointment) {
    return res.status(404).json({ success: false, message: "Appointment not found" });
  }

  console.log(`⚠️ Call issue reported for appointment ${appointmentId}:`, {
    userId, issueType, description,
    timestamp:  new Date(),
    callStatus: appointment.callStatus,
  });

  res.status(200).json({ success: true, message: "Issue reported successfully." });
});
