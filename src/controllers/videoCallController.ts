// controllers/videoCallController.ts
import { Request, Response } from "express";
import asyncHandler from "../middleware/asyncHandler";
import mongoose from "mongoose";
import { RtcTokenBuilder, RtcRole } from "agora-access-token";
import { Appointment } from "../models/appointment";
import { createNotificationForUser } from "../util/sendPushNotification";

const AGORA_APP_ID = process.env.AGORA_APP_ID!;
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE!;

if (!AGORA_APP_ID || !AGORA_APP_CERTIFICATE) {
  console.error("❌ Agora credentials are missing");
}

/* -------------------------------------------------------------------------- */
/*                                  Helpers                                   */
/* -------------------------------------------------------------------------- */

const extractId = (field: any): string => {
  if (!field) return "";
  if (typeof field === "string") return field;
  if (typeof field === "object" && field._id) return String(field._id);
  return String(field);
};

/**
 * Stable Agora UID (deterministic per user)
 */
const generateUid = (id: string): number => {
  const hex = id.replace(/[^a-f0-9]/gi, "").slice(-8);
  return parseInt(hex || "12345678", 16) % 2147483647;
};

/* -------------------------------------------------------------------------- */
/*                       Generate / Join Video Call Token                     */
/* -------------------------------------------------------------------------- */

export const generateVideoToken = asyncHandler(
  async (req: Request, res: Response) => {
    const { appointmentId } = req.body;
    const userId = req.auth?.id;
    const role = req.auth?.role; // "Doctor" | "User"

    // ========================================================================
    // 1️⃣ VALIDATION
    // ========================================================================

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

    // ========================================================================
    // 2️⃣ FETCH & AUTHORIZE
    // ========================================================================

    const appointment = await Appointment.findById(appointmentId)
      .populate("doctorId", "firstName lastName")
      .populate("userId", "firstName lastName");

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: "Appointment not found",
      });
    }

    const doctorId = extractId(appointment.doctorId);
    const patientId = extractId(appointment.userId);

    // Authorization check
    if (![doctorId, patientId].includes(userId)) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized: You are not part of this appointment",
      });
    }

    // Check if appointment is in valid status
    if (appointment.status === "cancelled") {
      return res.status(400).json({
        success: false,
        message: "This appointment has been cancelled",
      });
    }

    if (appointment.status === "completed" && appointment.callStatus === "ended") {
      return res.status(400).json({
        success: false,
        message: "This call has already ended",
      });
    }

    // Optional: Check if appointment time is reasonable
    const appointmentTime = new Date(appointment.scheduledAt);
    const now = new Date();
    const timeDiff = appointmentTime.getTime() - now.getTime();
    const hoursDiff = timeDiff / (1000 * 60 * 60);

    // Warn if joining too early (more than 15 minutes before)
    if (hoursDiff > 0.25) {
      console.log(`⚠️  User joining ${hoursDiff.toFixed(1)} hours early`);
    }

    const isDoctor = role === "Doctor";
    const isUser = role === "User";

    // ========================================================================
    // 3️⃣ INITIALIZE CALL METADATA (Idempotent)
    // ========================================================================

    if (!appointment.callChannelName) {
      appointment.callChannelName = `appt_${appointment._id}`;
    }

    if (!appointment.callParticipants) {
      appointment.callParticipants = [];
    }

    if (!appointment.agoraUidMap) {
      appointment.agoraUidMap = {};
    }

    const participantObjectId = new mongoose.Types.ObjectId(userId);
    const uid = generateUid(userId);

    // Add participant if not already present
    if (
      !appointment.callParticipants.some((id) =>
        id.equals(participantObjectId)
      )
    ) {
      appointment.callParticipants.push(participantObjectId);
    }

    // Map UID
    if (isDoctor) {
      appointment.agoraUidMap.doctor = uid;
    } else {
      appointment.agoraUidMap.user = uid;
    }

    // ========================================================================
    // 4️⃣ CALL LIFECYCLE MANAGEMENT
    // ========================================================================

    let shouldNotifyOtherParty = false;
    let otherPartyId: string | null = null;
    let notificationMessage = "";

    /**
     * STATE: idle → ringing (First person joins)
     */
    if (appointment.callStatus === "idle" || !appointment.callStatus) {
      appointment.callStatus = "ringing";
      appointment.callInitiatedBy = role as any;
      appointment.callStartedAt = new Date();
      
      // Update appointment status to in-progress when call starts
      if (appointment.status === "confirmed") {
        appointment.status = "in-progress";
      }

      shouldNotifyOtherParty = true;
      otherPartyId = isDoctor ? patientId : doctorId;
      notificationMessage = isDoctor
        ? "Dr. is calling you 📞"
        : "Your patient is calling you 📞";

      console.log(`📞 ${role} initiated call for appointment ${appointmentId}`);
    }

    /**
     * STATE: ringing → in-progress (Second person joins)
     */
    else if (
      appointment.callStatus === "ringing" &&
      appointment.callParticipants.length === 2
    ) {
      appointment.callStatus = "in-progress";
      
      console.log(`✅ Both parties joined - Call is now in-progress`);
      
      // Optionally notify the initiator that other party joined
      const initiatorId = isDoctor ? patientId : doctorId;
      shouldNotifyOtherParty = true;
      otherPartyId = initiatorId;
      notificationMessage = isDoctor
        ? "Patient has joined the call"
        : "Doctor has joined the call";
    }

    /**
     * STATE: in-progress → Allow rejoining
     */
    else if (appointment.callStatus === "in-progress") {
      console.log(`🔄 ${role} rejoining in-progress call`);
      // Just generate token, no state change needed
    }

    /**
     * STATE: ended → Prevent rejoining
     */
    else if (appointment.callStatus === "ended") {
      return res.status(400).json({
        success: false,
        message: "This call has already ended and cannot be rejoined",
      });
    }

    // ========================================================================
    // 5️⃣ SAVE CHANGES & GENERATE TOKEN
    // ========================================================================

    try {
      // Save appointment state
      await appointment.save();

      // Generate Agora token (1 hour validity)
      const expireAt = Math.floor(Date.now() / 1000) + 60 * 60;

      const token = RtcTokenBuilder.buildTokenWithUid(
        AGORA_APP_ID,
        AGORA_APP_CERTIFICATE,
        appointment.callChannelName,
        uid,
        RtcRole.PUBLISHER,
        expireAt
      );

      // Send notification AFTER successful token generation
      if (shouldNotifyOtherParty && otherPartyId) {
        try {
          await createNotificationForUser(
            otherPartyId,
            "Video Call",
            notificationMessage,
            "appointment",
            {
              appointmentId: (appointment._id as any).toString(),
              autoJoin: true,
              fromNotification: true,
            }
          );
          console.log(`📨 Notification sent to ${otherPartyId}`);
        } catch (notifError) {
          // Don't fail the request if notification fails
          console.error("⚠️  Failed to send notification:", notifError);
        }
      }

      return res.status(200).json({
        success: true,
        data: {
          token,
          channelName: appointment.callChannelName,
          uid,
          appId: AGORA_APP_ID,
          callStatus: appointment.callStatus,
          participantCount: appointment.callParticipants.length,
          isInitiator: appointment.callInitiatedBy === role,
        },
        message: "Token generated successfully",
      });
    } catch (error: any) {
      console.error("❌ Token generation failed:", error);

      // Rollback state if needed
      if (appointment.callStatus === "ringing" && appointment.callParticipants.length === 1) {
        appointment.callStatus = "idle";
        appointment.callParticipants = [];
        appointment.callInitiatedBy = undefined;
        appointment.callStartedAt = undefined;
        await appointment.save().catch(console.error);
      }

      return res.status(500).json({
        success: false,
        message: "Failed to generate video token",
        error: error.message,
      });
    }
  }
);

/* -------------------------------------------------------------------------- */
/*                                End Call                                    */
/* -------------------------------------------------------------------------- */

export const endVideoCall = asyncHandler(async (req, res) => {
  const { appointmentId, callDuration, callQuality } = req.body;
  const appointment = await Appointment.findById(appointmentId);
  if (!appointment) return res.status(404).json({ message: 'Appointment not found' });

  appointment.callStatus = 'ended';
  appointment.callEndedAt = new Date();
  appointment.callEndedBy = req.auth?.role as any;
  appointment.callDuration = callDuration;
  appointment.callQuality = callQuality;

  // Only mark appointment as completed if both participants left
  appointment.status = 'completed';
  await appointment.save();

  res.json({ success: true, message: 'Call ended successfully', data: appointment });
});


/* -------------------------------------------------------------------------- */
/*                             Get Call Status                                 */
/* -------------------------------------------------------------------------- */

export const getCallStatus = asyncHandler(
  async (req: Request, res: Response) => {
    const { appointmentId } = req.params;
    const userId = req.auth?.id;
    const role = req.auth?.role;

    const appointment = await Appointment.findById(appointmentId)
      .populate("doctorId", "firstName lastName")
      .populate("userId", "firstName lastName");

    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    const doctorId = extractId(appointment.doctorId);
    const patientId = extractId(appointment.userId);

    if (
      (role === "Doctor" && doctorId !== userId) ||
      (role === "User" && patientId !== userId)
    ) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const now = new Date();
    const scheduled = new Date(appointment.scheduledAt);
    const diffMinutes = Math.floor(
      (scheduled.getTime() - now.getTime()) / 60000
    );

    res.json({
      success: true,
      data: {
        appointmentId: appointment._id,
        status: appointment.status,
        callStatus: appointment.callStatus,
       isActive: appointment.callStatus === 'ringing' || appointment.callStatus === 'in-progress',
canJoin: appointment.callStatus !== 'ended',

        minutesUntilCall: diffMinutes,
        channelName: appointment.callChannelName,
        participants: appointment.callParticipants,
        doctorName: `Dr. ${(appointment.doctorId as any).firstName} ${
          (appointment.doctorId as any).lastName
        }`,
        patientName: `${(appointment.userId as any).firstName} ${
          (appointment.userId as any).lastName
        }`,
      },
    });
  }
);

/**
 * Report call issue
 */
export const reportCallIssue = asyncHandler(async (req: Request, res: Response) => {
  const { appointmentId, issueType, description } = req.body;
  const userId = req.auth?.id;

  if (!appointmentId || !issueType) return res.status(400).json({ message: 'Appointment ID and issue type are required' });

  const appointment = await Appointment.findById(appointmentId);
  if (!appointment) return res.status(404).json({ message: 'Appointment not found' });

  console.log(`⚠️ Call issue reported for appointment ${appointmentId}:`, {
    userId,
    issueType,
    description,
    timestamp: new Date(),
  });

  res.status(200).json({ success: true, message: 'Issue reported successfully' });
});


