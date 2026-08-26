// services/callSignaling.ts
//
// Single owner of "an incoming call is happening" for both call-initiation
// entry points (POST /video/token directly from the appointment page, and
// POST /chat/conversation/:id/video-request from a chat thread). Previously
// each path independently called socket-emit + push-send + DB-notify, which
// is exactly how the chat path ended up silently missing the real wake-up
// push for a while — nothing forced the two paths to stay in sync. Now
// neither path does any of that itself; they call notifyIncomingCall() (and
// cancelIncomingCall()) here, which does it once, correctly, for both.
//
// One further behavioral change from before: a chat-initiated call now
// reserves Appointment.callStatus = "ringing" at REQUEST time (via the same
// atomic compare-and-swap the direct-call path already used), not only once
// accepted. Two people can no longer end up with two simultaneous "ringing"
// states for the same appointment from the two different entry points.
import mongoose from "mongoose";
import { Appointment } from "../models/appointment";
import { NotificationService } from "./NotificationService";
import { sendIncomingCallPushNotification } from "../util/sendPushNotification";
import { io } from "../index";

export type IncomingCallSource = "appointment" | "chat";

export interface IncomingCallRequest {
  appointmentId: string;
  initiatorId: string;
  initiatorRole: "Doctor" | "User";
  recipientId: string;
  callerName: string;
  callerImage?: string;
  callType: "audio" | "video";
  source: IncomingCallSource;
  // Only present for a chat-originated call — lets the receiving client
  // resolve/accept through the chat-specific respond endpoint.
  conversationId?: string;
  videoRequestId?: string;
}

export interface IncomingCallPayload {
  appointmentId: string;
  callerId: string;
  callerName: string;
  callerImage?: string;
  callerType: "Doctor" | "User";
  channelName: string;
  callType: "audio" | "video";
  source: IncomingCallSource;
  conversationId?: string;
  videoRequestId?: string;
  expiresAt: string;
}

export type CallCancelReason = "cancelled" | "declined" | "expired" | "no-answer" | "answered-elsewhere";

const RING_TIMEOUT_MS = 60_000;

function emitToCall(appointmentId: string, recipientId: string, event: string, payload: unknown) {
  io.to(`appointment:${appointmentId}`).emit(event, payload);
  io.to(`user_${recipientId}`).emit(event, payload);
}

/**
 * Starts a ring: atomically reserves the appointment's call slot, fans out
 * the socket event + wake-up push + in-app notification, and arms a
 * server-side timer that auto-cancels the ring if nobody answers in time —
 * previously only the chat path had any expiry at all; a direct call could
 * sit in "ringing" forever with no one ever told it went unanswered.
 */
export async function notifyIncomingCall(
  req: IncomingCallRequest
): Promise<{ success: true; channelName: string } | { success: false; message: string }> {
  const channelName = `appt_${req.appointmentId}`;

  const reserved = await Appointment.findOneAndUpdate(
    { _id: req.appointmentId, callStatus: { $in: [null, "idle", "ended"] } },
    {
      $set: {
        callStatus: "ringing",
        callInitiatedBy: req.initiatorRole,
        callChannelName: channelName,
        callType: req.callType,
        status: "in-progress",
        callParticipants: [new mongoose.Types.ObjectId(req.initiatorId)],
        callStartedAt: null,
        callEndedAt: null,
        callEndedBy: null,
      },
    },
    { new: true }
  );

  if (!reserved) {
    return { success: false, message: "A call is already ringing or in progress for this appointment." };
  }

  const payload: IncomingCallPayload = {
    appointmentId: req.appointmentId,
    callerId: req.initiatorId,
    callerName: req.callerName,
    callerImage: req.callerImage,
    callerType: req.initiatorRole,
    channelName,
    callType: req.callType,
    source: req.source,
    conversationId: req.conversationId,
    videoRequestId: req.videoRequestId,
    expiresAt: new Date(Date.now() + RING_TIMEOUT_MS).toISOString(),
  };

  emitToCall(req.appointmentId, req.recipientId, "incoming-call", payload);

  sendIncomingCallPushNotification(req.recipientId, {
    appointmentId: req.appointmentId,
    callerName: req.callerName,
    callerImage: req.callerImage,
    callerType: req.initiatorRole,
    channelName,
    callType: req.callType,
    conversationId: req.conversationId,
    videoRequestId: req.videoRequestId,
  }).catch((err: any) => console.error("⚠️ Incoming-call push failed (non-fatal):", err.message));

  NotificationService.notifyCallStarted(
    req.recipientId,
    req.initiatorRole === "Doctor" ? "User" : "Doctor",
    req.appointmentId,
    req.callerName
  ).catch((err: any) => console.error("⚠️ Incoming-call in-app notification failed (non-fatal):", err.message));

  setTimeout(() => {
    expireRingIfStillRinging(req.appointmentId, req.initiatorId, req.recipientId).catch((err) =>
      console.error("⚠️ Ring-expiry check failed:", err)
    );
  }, RING_TIMEOUT_MS);

  return { success: true, channelName };
}

async function expireRingIfStillRinging(appointmentId: string, initiatorId: string, recipientId: string) {
  const expired = await Appointment.findOneAndUpdate(
    { _id: appointmentId, callStatus: "ringing" },
    { $set: { callStatus: "idle", callParticipants: [] } },
    { new: true }
  );
  if (!expired) return; // already answered, cancelled, or ended in the meantime

  io.to(`appointment:${appointmentId}`).emit("call-cancelled", { appointmentId, reason: "expired" });
  io.to(`user_${recipientId}`).emit("call-cancelled", { appointmentId, reason: "expired" });
  io.to(`user_${initiatorId}`).emit("call-cancelled", { appointmentId, reason: "no-answer" });
}

/**
 * Ends a ring before it's answered — either the caller cancelling their own
 * outgoing call, or the callee declining. Only valid while still "ringing";
 * an in-progress or already-ended call should go through /video/end-call
 * instead. Also used for the chat path's own cancel/decline endpoints so
 * both entry points share one implementation.
 */
export async function cancelIncomingCall(
  appointmentId: string,
  reason: CallCancelReason
): Promise<{ success: true; recipientIds: string[] } | { success: false }> {
  const appointment = await Appointment.findOneAndUpdate(
    { _id: appointmentId, callStatus: "ringing" },
    { $set: { callStatus: "idle", callParticipants: [] } },
    { new: true }
  );
  if (!appointment) return { success: false };

  const doctorId = String(appointment.doctorId);
  const patientId = String(appointment.userId);

  io.to(`appointment:${appointmentId}`).emit("call-cancelled", { appointmentId, reason });
  io.to(`user_${doctorId}`).emit("call-cancelled", { appointmentId, reason });
  io.to(`user_${patientId}`).emit("call-cancelled", { appointmentId, reason });

  return { success: true, recipientIds: [doctorId, patientId] };
}

/**
 * Fired the moment a ringing call is actually answered — tells every OTHER
 * session the same recipient might be logged into (e.g. mobile + web at
 * once) to stop ringing, WhatsApp-style "answered elsewhere". The session
 * that's actually joining also receives this; it's expected to ignore it
 * once it has locally committed to accepting (see client-side guards).
 */
export function notifyAnsweredElsewhere(appointmentId: string, recipientId: string) {
  io.to(`user_${recipientId}`).emit("call-cancelled", { appointmentId, reason: "answered-elsewhere" });
}
