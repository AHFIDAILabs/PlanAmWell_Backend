// controllers/videoCallController.ts
import { Request, Response } from "express";
import asyncHandler from "../middleware/asyncHandler";
import mongoose from "mongoose";
import { RtcTokenBuilder, RtcRole } from "agora-access-token";
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

const AGORA_APP_ID          = process.env.AGORA_APP_ID!;
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE!;

if (!AGORA_APP_ID || !AGORA_APP_CERTIFICATE) {
  console.error("❌ Agora credentials are missing");
}

const extractId = (field: any): string => {
  if (!field) return "";
  if (typeof field === "string") return field;
  if (typeof field === "object" && field._id) return String(field._id);
  return String(field);
};

const generateUid = (id: string): number => {
  const hex = id.replace(/[^a-f0-9]/gi, "").slice(-8);
  return parseInt(hex || "12345678", 16) % 2147483647;
};

// ─────────────────────────────────────────────────────────────────────────────
// Generate / Join Video Call Token
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

    if (!AGORA_APP_ID || !AGORA_APP_CERTIFICATE) {
      return res.status(500).json({
        success: false,
        message: "Video service not configured",
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

    // Appointment is completed (doctor pressed End Appointment) — no rejoining
    if (appointment.status === "completed") {
      return res.status(400).json({
        success: false,
        message: "This appointment has been ended by the doctor and cannot be rejoined",
      });
    }

    if (appointment.callStatus === "ended") {
      // Call ended but appointment still open — allow rejoin by resetting call
      console.log(`🔄 Resetting ended call for appointment ${appointmentId} — appointment still open`);
      appointment.callStatus    = "idle";
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

    const isDoctor           = role === "Doctor";
    const participantObjectId = new mongoose.Types.ObjectId(userId);
    const uid                = generateUid(userId);
    const recipientUserId    = isDoctor ? patientId : doctorId;
    const callerName         = isDoctor
      ? `Dr. ${(appointment.doctorId as any).firstName} ${(appointment.doctorId as any).lastName}`
      : ((appointment.userId as any).firstName || (appointment.userId as any).name);

    // ── Initiate call (atomic) ────────────────────────────────────────────────
    if (!appointment.callStatus || appointment.callStatus === "idle") {
      const updatedAppointment = await Appointment.findOneAndUpdate(
        { _id: appointmentId, callStatus: { $in: ["idle", null] } },
        {
          $set: {
            callStatus:      "ringing",
            callInitiatedBy: role,
            callChannelName: `appt_${appointmentId}`,
            status:          "in-progress",
            [`agoraUidMap.${isDoctor ? "doctor" : "user"}`]: uid,
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

          await sendIncomingCallPushNotification(recipientUserId, {
            appointmentId: appointmentId.toString(),
            callerName,
            callerImage,
            callerType:  role,
            channelName: appointment.callChannelName || `appt_${appointmentId}`,
          });

          emitCallRinging(appointmentId.toString(), role);

          await NotificationService.notifyCallStarted(
            recipientUserId,
            isDoctor ? "User" : "Doctor",
            appointmentId.toString(),
            callerName
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
      if (!appointment.agoraUidMap) appointment.agoraUidMap = {};
      if (isDoctor) appointment.agoraUidMap.doctor = uid;
      else          appointment.agoraUidMap.user   = uid;

      appointment.callParticipants.push(participantObjectId);
      appointment.callStatus    = "in-progress";
      appointment.callStartedAt = new Date();
      await appointment.save();

      try {
        emitRejoinCallAlert(isDoctor ? patientId : doctorId, appointmentId.toString(), callerName);
      } catch (e) {
        console.error("⚠️ Failed to send rejoin alert:", e);
      }
    }

    // ── Rejoin in-progress call ────────────────────────────────────────────────
    if (appointment.callStatus === "in-progress") {
      if (!appointment.agoraUidMap) appointment.agoraUidMap = {};
      if (isDoctor && !appointment.agoraUidMap.doctor) appointment.agoraUidMap.doctor = uid;
      else if (!isDoctor && !appointment.agoraUidMap.user) appointment.agoraUidMap.user = uid;

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

    // ── Generate Agora token ───────────────────────────────────────────────────
    try {
      const channelName = appointment.callChannelName || `appt_${appointmentId}`;
      const expireAt    = Math.floor(Date.now() / 1000) + 60 * 60;

      const token = RtcTokenBuilder.buildTokenWithUid(
        AGORA_APP_ID,
        AGORA_APP_CERTIFICATE,
        channelName,
        uid,
        RtcRole.PUBLISHER,
        expireAt
      );

      return res.status(200).json({
        success: true,
        data: {
          token,
          channelName,
          uid,
          appId:            AGORA_APP_ID,
          callStatus:       appointment.callStatus,
          participantCount: appointment.callParticipants.length,
          isInitiator:      appointment.callInitiatedBy === role,
          doctorName:       `Dr. ${(appointment.doctorId as any).firstName} ${(appointment.doctorId as any).lastName}`,
          patientName:      (appointment.userId as any).firstName || (appointment.userId as any).name,
        },
        message: "Token generated successfully",
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Failed to generate video token",
        error: error.message,
      });
    }
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
//
// When someone disconnects: mark the CALL as ended if both leave.
// The APPOINTMENT remains open — doctor must explicitly end it.
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

      // ── Only end the CALL, not the appointment ────────────────────────────
      appointment.callStatus  = "ended";
      appointment.callEndedAt = new Date();
      appointment.callEndedBy = "system";
      appointment.callDuration = callDuration;
      // appointment.status stays as-is — never set to 'completed' here

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
      // Remind the client the appointment is still active
      appointmentStatus: appointment.status,
    },
    message: "Disconnect handled",
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// End Video Call
//
// Called when a participant taps "End Call" in the video UI.
// Ends the CALL session only — appointment stays open.
// Doctor must tap "End Appointment" to complete the appointment.
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

  // ── End the CALL only ─────────────────────────────────────────────────────
  appointment.callStatus   = "ended";
  appointment.callEndedAt  = new Date();
  appointment.callEndedBy  = role as any;
  appointment.callDuration = finalDuration;
  // ✅ appointment.status is intentionally NOT changed here

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
      appointmentStatus: appointment.status,  // still 'in-progress' or 'confirmed'
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

  // Can join if: appointment not completed AND within 15-min window
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