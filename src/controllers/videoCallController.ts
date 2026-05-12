// controllers/videoCallController.ts
import { Request, Response } from "express";
import asyncHandler from "../middleware/asyncHandler";
import mongoose from "mongoose";
import { Appointment } from "../models/appointment";
import { NotificationService } from "../services/NotificationService";
import { emitCallEnded, emitCallRinging } from "../index";
import { sendIncomingCallPushNotification } from "../util/sendPushNotification";

// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN RULES for this controller:
//
//  1. NEVER call appointment.save() on a document fetched with .populate().
//     Mongoose re-validates populated subdocuments against ObjectId schemas and
//     throws CastError / ValidationError → 500 for the client.
//     Use Appointment.updateOne() or Appointment.findOneAndUpdate() instead.
//
//  2. The ONLY hard block is status === "cancelled". Every other status
//     (completed, expired, in-progress, confirmed …) is allowed to reset and
//     restart a call. The doctor controls appointment closure separately via
//     appointmentController.endAppointment.
//
//  3. callEndedBy tracks who ended the VIDEO CALL, not the appointment.
//     Do NOT use it to gate appointment-level access.
// ─────────────────────────────────────────────────────────────────────────────

const extractId = (field: any): string => {
  if (!field) return "";
  if (typeof field === "string") return field;
  if (typeof field === "object" && field._id) return String(field._id);
  return String(field);
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/video/token
// Start or join a call. Called by both the initiator and the receiver.
// ─────────────────────────────────────────────────────────────────────────────
export const generateVideoToken = asyncHandler(
  async (req: Request, res: Response) => {
    const { appointmentId } = req.body;
    const userId = req.auth?.id;
    const role   = req.auth?.role as "Doctor" | "User";

    if (!appointmentId || !userId || !role) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    // ── Fetch with populate (READ ONLY — we must not call .save() on this) ──
    const appointment = await Appointment.findById(appointmentId)
      .populate("doctorId", "firstName lastName doctorImage")
      .populate("userId",   "name userImage firstName lastName email phone");

    if (!appointment) {
      return res.status(404).json({ success: false, message: "Appointment not found" });
    }

    const doctorId  = extractId(appointment.doctorId);
    const patientId = extractId(appointment.userId);

    // ── Auth: only participants may join ────────────────────────────────────
    if (![doctorId, patientId].includes(userId)) {
      return res.status(403).json({ success: false, message: "You are not part of this appointment" });
    }

    // ── Hard block: cancelled appointments cannot have calls ───────────────
    if (appointment.status === "cancelled") {
      return res.status(400).json({ success: false, message: "This appointment has been cancelled" });
    }

    // ── 15-minute window check ──────────────────────────────────────────────
    const minutesDiff = (new Date(appointment.scheduledAt).getTime() - Date.now()) / 60000;
    if (minutesDiff > 15) {
      return res.status(400).json({
        success: false,
        message: `Call available 15 minutes before scheduled time. ${Math.ceil(minutesDiff - 15)} minute(s) remaining.`,
        minutesUntilAvailable: Math.ceil(minutesDiff - 15),
      });
    }

    // ── Derived values ──────────────────────────────────────────────────────
    const isDoctor            = role === "Doctor";
    const participantObjectId = new mongoose.Types.ObjectId(userId);
    const recipientId         = isDoctor ? patientId : doctorId;
    const channelName         = `appt_${appointmentId}`;
    const callerName          = isDoctor
      ? `Dr. ${(appointment.doctorId as any).firstName} ${(appointment.doctorId as any).lastName}`
      : ((appointment.userId as any).name ||
         `${(appointment.userId as any).firstName || ""} ${(appointment.userId as any).lastName || ""}`.trim());

    const currentCallStatus = appointment.callStatus;

    // ══════════════════════════════════════════════════════════════════════════
    // CASE A: Initiate a new call (idle / ended / no prior call state)
    // ══════════════════════════════════════════════════════════════════════════
    if (!currentCallStatus || currentCallStatus === "idle" || currentCallStatus === "ended") {
      // Atomic compare-and-swap: only wins if DB still shows idle/ended.
      // This prevents two simultaneous POST /token requests from both becoming
      // the initiator.
      const initiated = await Appointment.findOneAndUpdate(
        {
          _id:        appointmentId,
          callStatus: { $in: [null, "idle", "ended"] },
        },
        {
          $set: {
            callStatus:      "ringing",
            callInitiatedBy: role,
            callChannelName: channelName,
            status:          "in-progress",
            // Reset participant list — fresh call, fresh slate.
            callParticipants: [participantObjectId],
            // Clear stale call metadata from a previous call.
            callStartedAt: null,
            callEndedAt:   null,
            callEndedBy:   null,
          },
        },
        { new: true }
      );

      if (!initiated) {
        // Race condition: another request beat us. Re-read current state and
        // return it so the client can proceed as a joiner.
        const current = await Appointment.findById(appointmentId)
          .populate("doctorId", "firstName lastName")
          .populate("userId",   "name") as any;

        if (!current) {
          return res.status(404).json({ success: false, message: "Appointment not found after race condition" });
        }

        return res.json({
          success: true,
          data: {
            channelName:      current.callChannelName || channelName,
            callStatus:       current.callStatus,
            isInitiator:      current.callInitiatedBy === role,
            doctorName:       `Dr. ${(current.doctorId as any).firstName} ${(current.doctorId as any).lastName}`,
            patientName:      (current.userId as any).name || "",
          },
          message: "Joined existing call",
        });
      }

      // ── Notify the other participant (fire-and-forget) ───────────────────
      try {
        const Conversation = require("../models/conversation").default;
        const conversation = appointment.conversationId
          ? await Conversation.findById(appointment.conversationId)
          : await Conversation.findOne({ appointmentId });

        sendIncomingCallPushNotification(recipientId, {
          appointmentId: appointmentId.toString(),
          callerName,
          callerImage: isDoctor
            ? (appointment.doctorId as any).doctorImage
            : (appointment.userId  as any).userImage,
          callerType:     role,
          channelName,
          conversationId: conversation?._id?.toString(),
          videoRequestId: conversation?.activeVideoRequest?._id?.toString(),
        }).catch((err: any) =>
          console.error("⚠️ Push notification failed (non-fatal):", err.message)
        );

        emitCallRinging(appointmentId.toString(), role);

        NotificationService.notifyCallStarted(
          recipientId,
          isDoctor ? "User" : "Doctor",
          appointmentId.toString(),
          callerName
        ).catch((err: any) =>
          console.error("⚠️ In-app notification failed (non-fatal):", err.message)
        );
      } catch (notifErr) {
        console.error("⚠️ Notification block failed (non-fatal):", notifErr);
      }

      return res.json({
        success: true,
        data: {
          channelName,
          callStatus:  "ringing",
          isInitiator: true,
          doctorName:  `Dr. ${(appointment.doctorId as any).firstName} ${(appointment.doctorId as any).lastName}`,
          patientName: (appointment.userId as any).name || "",
        },
        message: "Call initiated",
      });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // CASE B: Second participant answers the ringing call
    // ══════════════════════════════════════════════════════════════════════════
    if (currentCallStatus === "ringing") {
      // Atomic — if callStatus changed between our read and this write, the
      // update simply matches 0 documents and the call proceeds on current data.
      await Appointment.updateOne(
        { _id: appointmentId, callStatus: "ringing" },
        {
          $set: {
            callStatus:   "in-progress",
            callStartedAt: new Date(),
          },
          $addToSet: { callParticipants: participantObjectId },
        }
      );

      return res.json({
        success: true,
        data: {
          channelName:  appointment.callChannelName || channelName,
          callStatus:   "in-progress",
          // The original initiator is determined by callInitiatedBy stored in DB.
          // The second joiner is never the initiator.
          isInitiator:  false,
          doctorName:   `Dr. ${(appointment.doctorId as any).firstName} ${(appointment.doctorId as any).lastName}`,
          patientName:  (appointment.userId as any).name || "",
        },
        message: "Joined call",
      });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // CASE C: Rejoin an already in-progress call (network drop, app restart …)
    // ══════════════════════════════════════════════════════════════════════════
    if (currentCallStatus === "in-progress") {
      await Appointment.updateOne(
        { _id: appointmentId },
        { $addToSet: { callParticipants: participantObjectId } }
      );

      return res.json({
        success: true,
        data: {
          channelName:  appointment.callChannelName || channelName,
          callStatus:   "in-progress",
          // Preserve original initiator role so WebRTC offer/answer logic stays correct.
          isInitiator:  appointment.callInitiatedBy === role,
          doctorName:   `Dr. ${(appointment.doctorId as any).firstName} ${(appointment.doctorId as any).lastName}`,
          patientName:  (appointment.userId as any).name || "",
        },
        message: "Rejoined call",
      });
    }

    // Should not reach here — unknown callStatus
    return res.status(400).json({
      success: false,
      message: `Cannot join call in current state: ${currentCallStatus}`,
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/video/end-call
// End the video call. Uses atomic updateOne — no .save() on populated doc.
// ─────────────────────────────────────────────────────────────────────────────
export const endVideoCall = asyncHandler(async (req: Request, res: Response) => {
  const { appointmentId, callDuration, callQuality } = req.body;
  const userId = req.auth?.id;
  const role   = req.auth?.role;

  if (!appointmentId) {
    return res.status(400).json({ success: false, message: "appointmentId is required" });
  }

  const finalDuration = typeof callDuration === "number" && callDuration >= 0
    ? callDuration
    : 0;

  // Atomic: idempotent — safe to call twice (second call just updates endedAt).
  const result = await Appointment.findOneAndUpdate(
    { _id: appointmentId },
    {
      $set: {
        callStatus:   "ended",
        callEndedAt:  new Date(),
        callEndedBy:  role || "system",
        callDuration: finalDuration,
        ...(callQuality ? { callQuality } : {}),
      },
    },
    { new: true }
  );

  if (!result) {
    return res.status(404).json({ success: false, message: "Appointment not found" });
  }

  // Notify everyone in the appointment room that the call has ended.
  emitCallEnded(userId!, appointmentId.toString(), finalDuration);

  return res.json({
    success: true,
    message: "Call ended. Appointment remains open — doctor can close it when ready.",
    data: {
      appointmentId,
      callDuration: finalDuration,
      endedBy:      role,
      endedAt:      result.callEndedAt,
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/video/decline
// Receiver declines a ringing call. Resets callStatus and notifies the room.
// ─────────────────────────────────────────────────────────────────────────────
export const declineCall = asyncHandler(async (req: Request, res: Response) => {
  const { appointmentId } = req.body;
  const userId = req.auth?.id;

  if (!appointmentId || !userId) {
    return res.status(400).json({ success: false, message: "Missing required fields" });
  }

  // Only reset if still ringing — idempotent otherwise.
  await Appointment.updateOne(
    { _id: appointmentId, callStatus: "ringing" },
    {
      $set: {
        callStatus:       "idle",
        callParticipants: [],
      },
    }
  );

  // Notify the initiator (who is waiting in the appointment socket room).
  const { io } = require("../index");
  io.to(`appointment:${appointmentId}`).emit("call-declined", {
    appointmentId,
    declinedBy: userId,
    timestamp:  new Date().toISOString(),
  });

  console.log(`📵 Call declined for appointment ${appointmentId} by ${userId}`);
  return res.json({ success: true, message: "Call declined" });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/video/call-status/:appointmentId
// ─────────────────────────────────────────────────────────────────────────────
export const getCallStatus = asyncHandler(async (req: Request, res: Response) => {
  const { appointmentId } = req.params;
  const userId = req.auth?.id;
  const role   = req.auth?.role;

  const appointment = await Appointment.findById(appointmentId)
    .populate("doctorId", "firstName lastName")
    .populate("userId",   "name firstName lastName");

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

  const minutesDiff = Math.floor((new Date(appointment.scheduledAt).getTime() - Date.now()) / 60000);
  const canJoin     = appointment.status !== "cancelled" && minutesDiff <= 15;

  return res.json({
    success: true,
    data: {
      appointmentId:       appointment._id,
      status:              appointment.status,
      callStatus:          appointment.callStatus,
      isActive:            appointment.callStatus === "ringing" || appointment.callStatus === "in-progress",
      canJoin,
      canRejoin:           appointment.status !== "cancelled" && appointment.callStatus === "ended",
      minutesUntilCall:    minutesDiff,
      minutesUntilCanJoin: Math.max(0, minutesDiff - 15),
      channelName:         appointment.callChannelName,
      callStartedAt:       appointment.callStartedAt,
      callDuration:        appointment.callDuration,
      doctorName:  `Dr. ${(appointment.doctorId as any).firstName} ${(appointment.doctorId as any).lastName}`,
      patientName: (appointment.userId as any).name ||
                   `${(appointment.userId as any).firstName || ""} ${(appointment.userId as any).lastName || ""}`.trim(),
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/video/join
// Confirm the second participant has connected. Atomic — no .save().
// ─────────────────────────────────────────────────────────────────────────────
export const confirmCallJoin = asyncHandler(async (req: Request, res: Response) => {
  const { appointmentId } = req.body;
  const userId = req.auth?.id;

  if (!appointmentId || !userId) {
    return res.status(400).json({ success: false, message: "Missing required fields" });
  }

  await Appointment.updateOne(
    { _id: appointmentId, callStatus: "ringing" },
    {
      $set: {
        callStatus:    "in-progress",
        callStartedAt: new Date(),
      },
      $addToSet: { callParticipants: new mongoose.Types.ObjectId(userId) },
    }
  );

  return res.json({ success: true, message: "Call join confirmed" });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/video/heartbeat  (best-effort — no DB writes needed)
// ─────────────────────────────────────────────────────────────────────────────
export const updateParticipantHeartbeat = asyncHandler(
  async (_req: Request, res: Response) => {
    return res.json({ success: true });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/video/disconnect  (acknowledgement only — endVideoCall handles state)
// ─────────────────────────────────────────────────────────────────────────────
export const handleCallDisconnect = asyncHandler(async (req: Request, res: Response) => {
  const { appointmentId } = req.body;
  const userId = req.auth?.id;
  const role   = req.auth?.role;

  if (!appointmentId || !userId) {
    return res.status(400).json({ success: false, message: "Missing required fields" });
  }

  console.log(`🔌 ${role} (${userId}) disconnected from appointment ${appointmentId}`);
  return res.json({ success: true, message: "Disconnect acknowledged" });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/video/ice-servers
// Returns ICE server config from environment variables so TURN credentials can
// be rotated on the backend without ever rebuilding the mobile app.
//
// Env vars (all optional — app falls back to Google STUN if none are set):
//   STUN_SERVER_URL       e.g. stun:stun.relay.metered.ca:80
//   TURN_SERVER_URL_1..4  e.g. turn:global.relay.metered.ca:80
//   TURN_USERNAME_1..4    matching username
//   TURN_CREDENTIAL_1..4  matching credential
// ─────────────────────────────────────────────────────────────────────────────
export const getIceServers = asyncHandler(async (_req: Request, res: Response) => {
  const servers: any[] = [];

  // Custom STUN (Metered) — falls back to Google STUN if not set
  const stunUrl = process.env.STUN_SERVER_URL || "stun:stun.l.google.com:19302";
  servers.push({ urls: stunUrl });
  servers.push({ urls: "stun:stun1.l.google.com:19302" });

  // Up to 4 TURN entries — add each one that has a URL configured
  for (let i = 1; i <= 4; i++) {
    const url        = process.env[`TURN_SERVER_URL_${i}`];
    const username   = process.env[`TURN_USERNAME_${i}`]   || "";
    const credential = process.env[`TURN_CREDENTIAL_${i}`] || "";
    if (url) servers.push({ urls: url, username, credential });
  }

  return res.json({ success: true, data: { iceServers: servers } });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/video/report-issue
// ─────────────────────────────────────────────────────────────────────────────
export const reportCallIssue = asyncHandler(async (req: Request, res: Response) => {
  const { appointmentId, issueType, description } = req.body;
  const userId = req.auth?.id;

  if (!appointmentId || !issueType) {
    return res.status(400).json({ success: false, message: "appointmentId and issueType are required" });
  }

  console.log(`⚠️ Call issue [${issueType}] reported by ${userId} for appointment ${appointmentId}: ${description || ""}`);
  return res.status(200).json({ success: true, message: "Issue reported" });
});
