// controllers/videoCallController.ts - UPGRADED WITH ATOMIC OPERATIONS
import { Request, Response } from "express";
import asyncHandler from "../middleware/asyncHandler";
import mongoose from "mongoose";
import { RtcTokenBuilder, RtcRole } from "agora-access-token";
import { Appointment } from "../models/appointment";
import { NotificationService } from "../services/NotificationService";
import { emitRejoinCallAlert, emitCallEnded } from "../index";

const AGORA_APP_ID = process.env.AGORA_APP_ID!;
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

/**
 * ✅ Generate / Join Video Call Token (ATOMIC OPERATIONS)
 */
export const generateVideoToken = asyncHandler(
  async (req: Request, res: Response) => {
    const { appointmentId } = req.body;
    const userId = req.auth?.id;
    const role = req.auth?.role;

    if (!appointmentId || !userId || !role) {
      return res.status(400).json({
        success: false,
        message: "Invalid request: Missing required fields",
      });
    }

    if (!AGORA_APP_ID || !AGORA_APP_CERTIFICATE) {
      console.error("❌ Agora credentials not configured");
      return res.status(500).json({
        success: false,
        message: "Video service not configured",
      });
    }

    let appointment = await Appointment.findById(appointmentId)
      .populate("doctorId", "firstName lastName doctorImage email contactNumber licenseNumber")
      .populate("userId", "name userImage email phone");

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: "Appointment not found",
      });
    }

    const doctorId = extractId(appointment.doctorId);
    const patientId = extractId(appointment.userId);

    if (![doctorId, patientId].includes(userId)) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized: You are not part of this appointment",
      });
    }

    if (appointment.status === "cancelled") {
      return res.status(400).json({
        success: false,
        message: "This appointment has been cancelled",
      });
    }

    if (appointment.callStatus === "ended") {
      return res.status(400).json({
        success: false,
        message: "This call has already ended and cannot be rejoined",
      });
    }

    // ✅ CHECK TIMING: 15-min window
    const appointmentTime = new Date(appointment.scheduledAt);
    const now = new Date();
    const timeDiff = appointmentTime.getTime() - now.getTime();
    const minutesDiff = timeDiff / (1000 * 60);

    if (minutesDiff > 15) {
      return res.status(400).json({
        success: false,
        message: `Call can only be joined within 15 minutes of scheduled time. Please wait ${Math.floor(minutesDiff - 15)} more minutes.`,
        minutesUntilAvailable: Math.floor(minutesDiff - 15),
      });
    }

    const isDoctor = role === "Doctor";
    const participantObjectId = new mongoose.Types.ObjectId(userId);
    const uid = generateUid(userId);

    const notifyingUserId = isDoctor ? patientId : doctorId;
    const currentUserName = isDoctor
      ? `Dr. ${(appointment.doctorId as any).firstName} ${(appointment.doctorId as any).lastName}`
      : ((appointment.userId as any).firstName || (appointment.userId as any).name);

    // ✅ ATOMIC OPERATION: Try to initiate call (prevents race condition)
    if (!appointment.callStatus || appointment.callStatus === "idle") {
      // console.log(`📞 ${role} attempting to initiate call for appointment ${appointmentId}`);

      const updatedAppointment = await Appointment.findOneAndUpdate(
        {
          _id: appointmentId,
          callStatus: { $in: ["idle", null] }, // ✅ ATOMIC: Only update if idle
        },
        {
          $set: {
            callStatus: "ringing",
            callInitiatedBy: role,
            callChannelName: `appt_${appointmentId}`,
            status: "in-progress",
            [`agoraUidMap.${isDoctor ? "doctor" : "user"}`]: uid,
          },
          $addToSet: {
            callParticipants: participantObjectId,
          },
        },
        { new: true }
      )
        .populate("doctorId", "firstName lastName doctorImage")
        .populate("userId", "name userImage");

      if (updatedAppointment) {
        appointment = updatedAppointment;
        // console.log(`✅ ${role} successfully initiated call`);

        // ✅ NOTIFICATION: Call starting
        try {
          const recipientType = isDoctor ? "User" : "Doctor";

          await NotificationService.notifyCallStarted(
            notifyingUserId,
            recipientType,
            appointmentId.toString(),
            currentUserName
          );

          emitRejoinCallAlert(notifyingUserId, appointmentId.toString(), currentUserName);

          // console.log(`📨 Notification sent to ${isDoctor ? "PATIENT" : "DOCTOR"} (${notifyingUserId})`);
        } catch (notifError) {
          console.error("⚠️ Failed to send notification:", notifError);
        }
      } else {
        // Someone else initiated - reload appointment
        appointment = await Appointment.findById(appointmentId)
          .populate("doctorId", "firstName lastName")
          .populate("userId", "name");

        if (!appointment) {
          return res.status(404).json({
            success: false,
            message: "Appointment not found after race condition",
          });
        }

        // console.log(`🔄 ${role} joining call initiated by ${appointment.callInitiatedBy}`);
      }
    }

    // ✅ SECOND PARTICIPANT JOINS
    if (
      appointment.callStatus === "ringing" &&
      !appointment.callParticipants.some((id) => id.equals(participantObjectId))
    ) {
      // console.log(`✅ ${role} is second participant - transitioning to in-progress`);

      if (!appointment.agoraUidMap) appointment.agoraUidMap = {};
      
      if (isDoctor) {
        appointment.agoraUidMap.doctor = uid;
      } else {
        appointment.agoraUidMap.user = uid;
      }

      appointment.callParticipants.push(participantObjectId);
      await appointment.save();

      const initiatorId = isDoctor ? patientId : doctorId;

      try {
        emitRejoinCallAlert(initiatorId, appointmentId.toString(), currentUserName);
        // console.log(`📨 Rejoin alert sent to initiator (${initiatorId})`);
      } catch (notifError) {
        console.error("⚠️ Failed to send rejoin alert:", notifError);
      }
    }

    // ✅ REJOIN IN-PROGRESS CALL
    if (appointment.callStatus === "in-progress") {
      // console.log(`🔄 ${role} rejoining in-progress call`);

      if (!appointment.agoraUidMap) appointment.agoraUidMap = {};
      
      if (isDoctor && !appointment.agoraUidMap.doctor) {
        appointment.agoraUidMap.doctor = uid;
      } else if (!isDoctor && !appointment.agoraUidMap.user) {
        appointment.agoraUidMap.user = uid;
      }

      if (!appointment.callParticipants.some((id) => id.equals(participantObjectId))) {
        appointment.callParticipants.push(participantObjectId);
      }

      await appointment.save();

      const otherPartyId = isDoctor ? patientId : doctorId;

      try {
        emitRejoinCallAlert(otherPartyId, appointmentId.toString(), currentUserName);
        // console.log(`📨 Rejoin alert sent to other party (${otherPartyId})`);
      } catch (notifError) {
        console.error("⚠️ Failed to send rejoin alert:", notifError);
      }
    }

    // ✅ GENERATE AGORA TOKEN
    try {
      const channelName = appointment.callChannelName || `appt_${appointmentId}`;
      const expireAt = Math.floor(Date.now() / 1000) + 60 * 60;

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
          appId: AGORA_APP_ID,
          callStatus: appointment.callStatus,
          participantCount: appointment.callParticipants.length,
          isInitiator: appointment.callInitiatedBy === role,
          doctorName: `Dr. ${(appointment.doctorId as any).firstName} ${(appointment.doctorId as any).lastName}`,
          patientName: (appointment.userId as any).firstName || (appointment.userId as any).name,
        },
        message: "Token generated successfully",
      });
    } catch (error: any) {
      console.error("❌ Token generation failed:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to generate video token",
        error: error.message,
      });
    }
  }
);

/**
 * ✅ Confirm Call Join
 */
export const confirmCallJoin = asyncHandler(
  async (req: Request, res: Response) => {
    const { appointmentId } = req.body;
    const userId = req.auth?.id;

    if (!appointmentId || !userId) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    const appointment = await Appointment.findById(appointmentId)
      .populate("doctorId", "firstName lastName doctorImage")
      .populate("userId", "name userImage");

    if (!appointment) {
      return res.status(404).json({ success: false, message: "Appointment not found" });
    }

    const doctorId = extractId(appointment.doctorId);
    const patientId = extractId(appointment.userId);

    if (![doctorId, patientId].includes(userId)) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    (appointment as any).addActiveParticipant(userId);

    const activeCount = (appointment as any).getActiveParticipantCount();

    if (appointment.callStatus === "ringing" && activeCount === 2) {
      // console.log(`✅ Both participants active - transitioning to in-progress`);

      appointment.callStatus = "in-progress";
      appointment.callStartedAt = new Date();

      appointment.callAttempts.push({
        startedAt: new Date(),
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
        callStatus: appointment.callStatus,
        activeParticipants: activeCount,
        callStartedAt: appointment.callStartedAt,
      },
      message: "Call join confirmed",
    });
  }
);

/**
 * ✅ Participant Heartbeat
 */
export const updateParticipantHeartbeat = asyncHandler(
  async (req: Request, res: Response) => {
    const { appointmentId } = req.body;
    const userId = req.auth?.id;

    if (!appointmentId || !userId) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    const appointment = await Appointment.findById(appointmentId);

    if (!appointment) {
      return res.status(404).json({ success: false, message: "Appointment not found" });
    }

    const participantId = new mongoose.Types.ObjectId(userId);
    const participant = appointment.activeParticipants.find((p) =>
      p.userId.equals(participantId)
    );

    if (participant) {
      participant.lastPing = new Date();
      await appointment.save();
    }

    res.json({ success: true });
  }
);

/**
 * ✅ Handle Call Disconnect
 */
export const handleCallDisconnect = asyncHandler(
  async (req: Request, res: Response) => {
    const { appointmentId } = req.body;
    const userId = req.auth?.id;
    const role = req.auth?.role;

    if (!appointmentId || !userId) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    const appointment = await Appointment.findById(appointmentId)
      .populate("doctorId", "firstName lastName doctorImage")
      .populate("userId", "name userImage");

    if (!appointment) {
      return res.status(404).json({ success: false, message: "Appointment not found" });
    }

    console.log(`🔌 ${role} disconnecting from call ${appointmentId}`);

    (appointment as any).removeActiveParticipant(userId);

    const activeCount = (appointment as any).getActiveParticipantCount();

    // ✅ AUTO-END: Both participants disconnected
    if (activeCount === 0 && appointment.callStatus === "in-progress") {
      const callDuration = appointment.callStartedAt
        ? Math.floor((Date.now() - appointment.callStartedAt.getTime()) / 1000)
        : 0;

      if (callDuration > 30) {
        console.log(`⏹️ Both participants disconnected - ending call after ${callDuration}s`);
        
        appointment.callStatus = "ended";
        appointment.callEndedAt = new Date();
        appointment.callEndedBy = "system";
        appointment.callDuration = callDuration;
        appointment.status = "completed";

        const lastAttempt = appointment.callAttempts[appointment.callAttempts.length - 1];
        if (lastAttempt && !lastAttempt.endedAt) {
          lastAttempt.endedAt = new Date();
          lastAttempt.endReason = "disconnected";
          lastAttempt.duration = callDuration;
        }

        emitCallEnded("system", appointmentId.toString(), callDuration);

        console.log(`🔔 Call ended (system) event sent to appointment room ${appointmentId}`);
      } else {
        console.log(`⏳ Call too short (${callDuration}s) - allowing reconnection`);
      }
    }

    await appointment.save();

    res.json({
      success: true,
      data: {
        callStatus: appointment.callStatus,
        activeParticipants: activeCount,
        callEnded: appointment.callStatus === "ended",
      },
      message: "Disconnect handled",
    });
  }
);

/**
 * ✅ End Call
 */
export const endVideoCall = asyncHandler(async (req: Request, res: Response) => {
  const { appointmentId, callDuration, callQuality } = req.body;
  const userId = req.auth?.id;
  const role = req.auth?.role;

  const appointment = await Appointment.findById(appointmentId)
    .populate("doctorId", "firstName lastName doctorImage")
    .populate("userId", "name userImage");

  if (!appointment) {
    return res.status(404).json({ success: false, message: "Appointment not found" });
  }

  const wasAlreadyEnded = appointment.callStatus === "ended";

  if (wasAlreadyEnded) {
    return res.json({
      success: true,
      message: "Call already ended",
      data: appointment,
    });
  }

  // console.log(`🛑 ${role} ending call for appointment ${appointmentId}`);

  const finalDuration =
    callDuration ||
    (appointment.callStartedAt
      ? Math.floor((Date.now() - appointment.callStartedAt.getTime()) / 1000)
      : 0);

  appointment.callStatus = "ended";
  appointment.callEndedAt = new Date();
  appointment.callEndedBy = role as any;
  appointment.callDuration = finalDuration;
  appointment.status = "completed";

  if (callQuality) appointment.callQuality = callQuality;

  const lastAttempt = appointment.callAttempts[appointment.callAttempts.length - 1];
  if (lastAttempt && !lastAttempt.endedAt) {
    lastAttempt.endedAt = new Date();
    lastAttempt.endReason = "completed";
    lastAttempt.duration = finalDuration;
    lastAttempt.quality = callQuality;
  }

  await appointment.save();

  emitCallEnded(userId!, appointmentId.toString(), finalDuration);

  // console.log(`🔔 Call ended event sent to appointment room ${appointmentId}`);

  res.json({
    success: true,
    message: "Call ended successfully",
    data: {
      appointmentId: appointment._id,
      callDuration: finalDuration,
      callQuality: appointment.callQuality,
      endedBy: role,
      endedAt: appointment.callEndedAt,
    },
  });
});

/**
 * ✅ Get Call Status
 */
export const getCallStatus = asyncHandler(async (req: Request, res: Response) => {
  const { appointmentId } = req.params;
  const userId = req.auth?.id;
  const role = req.auth?.role;

  const appointment = await Appointment.findById(appointmentId)
    .populate("doctorId", "firstName lastName doctorImage")
    .populate("userId", "name userImage");

  if (!appointment) {
    return res.status(404).json({ success: false, message: "Appointment not found" });
  }

  const doctorId = extractId(appointment.doctorId);
  const patientId = extractId(appointment.userId);

  if ((role === "Doctor" && doctorId !== userId) || (role === "User" && patientId !== userId)) {
    return res.status(403).json({ success: false, message: "Unauthorized" });
  }

  const now = new Date();
  const scheduled = new Date(appointment.scheduledAt);
  const diffMinutes = Math.floor((scheduled.getTime() - now.getTime()) / 60000);

  const canJoinNow = diffMinutes <= 15 && appointment.callStatus !== "ended";

  res.json({
    success: true,
    data: {
      appointmentId: appointment._id,
      status: appointment.status,
      callStatus: appointment.callStatus,
      isActive: appointment.callStatus === "ringing" || appointment.callStatus === "in-progress",
      canJoin: canJoinNow,
      minutesUntilCall: diffMinutes,
      minutesUntilCanJoin: Math.max(0, diffMinutes - 15),
      channelName: appointment.callChannelName,
      activeParticipants: (appointment as any).getActiveParticipantCount(),
      totalParticipants: appointment.callParticipants.length,
      callStartedAt: appointment.callStartedAt,
      callDuration: appointment.callDuration,
      doctorName: `Dr. ${(appointment.doctorId as any).firstName} ${(appointment.doctorId as any).lastName}`,
      patientName: (appointment.userId as any).firstName || (appointment.userId as any).name,
    },
  });
});

/**
 * ✅ Report Call Issue
 */
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

  // console.log(`⚠️ Call issue reported for appointment ${appointmentId}:`, {
  //   userId,
  //   issueType,
  //   description,
  //   timestamp: new Date(),
  //   callStatus: appointment.callStatus,
  // });

  res.status(200).json({ success: true, message: "Issue reported successfully." });
});