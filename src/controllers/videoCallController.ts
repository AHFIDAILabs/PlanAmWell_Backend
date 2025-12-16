// controllers/videoCallController.ts
import { Request, Response } from 'express';
import asyncHandler from '../middleware/asyncHandler';
import { RtcTokenBuilder, RtcRole } from 'agora-access-token';
import { Appointment } from '../models/appointment';
import { createNotificationForUser } from '../util/sendPushNotification';

const AGORA_APP_ID = process.env.AGORA_APP_ID || '';
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE || '';

if (!AGORA_APP_ID || !AGORA_APP_CERTIFICATE) {
  console.error('❌ AGORA_APP_ID and AGORA_APP_CERTIFICATE must be set');
}

// Helper to normalize IDs
const extractId = (field: any): string => {
  if (!field) return '';
  if (typeof field === 'string') return field;
  if (typeof field === 'object' && field._id) return String(field._id);
  return String(field);
};

// Generate stable Agora UID based on user ID
const generateUid = (id: string): number =>
  parseInt(id.replace(/[^a-f0-9]/gi, "").slice(-8), 16) % 2147483647 ||
  Math.floor(Math.random() * 2147483647);

/**
 * Generate Agora RTC token for a video call
 */
export const generateVideoToken = asyncHandler(async (req: Request, res: Response) => {
  const { appointmentId } = req.body;
  const userId = req.auth?.id;
  const role = req.auth?.role;

  if (!appointmentId || !userId || !role) {
    return res.status(400).json({ message: "Invalid request" });
  }

  const appointment = await Appointment.findById(appointmentId)
    .populate("doctorId", "firstName lastName")
    .populate("userId", "firstName lastName");

  if (!appointment) return res.status(404).json({ message: "Appointment not found" });

  const doctorId = extractId(appointment.doctorId);
  const patientId = extractId(appointment.userId);
  const requesterId = String(userId);

  if (![doctorId, patientId].includes(requesterId)) {
    return res.status(403).json({ message: "Unauthorized" });
  }

  // Generate channel name if missing
  const channelName = appointment.callChannelName || `appt_${appointmentId}`;
  const uid = generateUid(requesterId);

  // Initialize participants map if missing
  if (!appointment.callParticipants) appointment.callParticipants = [];
  if (!appointment.agoraUidMap) appointment.agoraUidMap = {};

  // Add requester to participants if not already there
  if (!appointment.callParticipants.includes(requesterId as any)) {
    appointment.callParticipants.push(requesterId as any);
  }

  // Store Agora UID
  appointment.agoraUidMap[requesterId === doctorId ? 'doctor' : 'user'] = uid;

  // Update call status if idle
  if (appointment.callStatus === 'idle') {
    appointment.callStatus = 'ringing';
    appointment.callInitiatedBy = role as any;
    appointment.callStartedAt = new Date();

    const otherUserId = requesterId === doctorId ? patientId : doctorId;
    await createNotificationForUser(
      otherUserId,
      "Incoming Video Call",
      "Your consultation has started",
      "appointment",
      { appointmentId }
    );
  } else {
    appointment.callStatus = 'in-progress';
  }

  // Update appointment status
  appointment.status = 'in-progress';
  appointment.callChannelName = channelName;

  await appointment.save();

  // Generate Agora token
  const expirationTime = Math.floor(Date.now() / 1000) + 86400; // 24h
  const token = RtcTokenBuilder.buildTokenWithUid(
    AGORA_APP_ID,
    AGORA_APP_CERTIFICATE,
    channelName,
    uid,
    RtcRole.PUBLISHER,
    expirationTime
  );

  res.status(200).json({
    success: true,
    data: {
      token,
      channelName,
      uid,
      appId: AGORA_APP_ID,
      callStatus: appointment.callStatus,
    },
  });
});

/**
 * End video call
 */
export const endVideoCall = asyncHandler(async (req: Request, res: Response) => {
  const { appointmentId, callDuration, callQuality } = req.body;
  const userId = req.auth?.id;
  const role = req.auth?.role;

  const appointment = await Appointment.findById(appointmentId);
  if (!appointment) return res.status(404).json({ message: 'Appointment not found' });

  appointment.callStatus = 'ended';
  appointment.callEndedAt = new Date();
  appointment.callEndedBy = role as any;
  appointment.callDuration = callDuration;
  appointment.callQuality = callQuality;
  appointment.status = 'completed';

  await appointment.save();

  res.json({ success: true, message: "Call ended successfully" });
});

/**
 * Get current call status
 */
export const getCallStatus = asyncHandler(async (req: Request, res: Response) => {
  const { appointmentId } = req.params;
  const userId = req.auth?.id;
  const role = req.auth?.role;

  const appointment = await Appointment.findById(appointmentId)
    .populate('userId', 'firstName lastName')
    .populate('doctorId', 'firstName lastName');

  if (!appointment) return res.status(404).json({ message: 'Appointment not found' });

  // Extract IDs for authorization
  const doctorId = extractId(appointment.doctorId);
  const patientId = extractId(appointment.userId);
  const requesterId = String(userId);

  const isAuthorized = (role === 'Doctor' && doctorId === requesterId) || (role === 'User' && patientId === requesterId);
  if (!isAuthorized) return res.status(403).json({ message: 'Not authorized to view this call' });

  // Timing info
  const now = new Date();
  const scheduledTime = new Date(appointment.scheduledAt);
  const minutesDiff = Math.floor((scheduledTime.getTime() - now.getTime()) / (1000 * 60));
  const canJoin = minutesDiff <= 15 && minutesDiff >= -120;

  res.status(200).json({
    success: true,
    data: {
      appointmentId: appointment._id,
      status: appointment.status,
      scheduledAt: appointment.scheduledAt,
      callStatus: appointment.callStatus ?? 'idle',
      isActive: appointment.callStatus !== 'idle' && appointment.callStatus !== 'ended',
      canJoin,
      minutesUntilCall: minutesDiff,
      isDoctor: role === 'Doctor',
      callDuration: appointment.callDuration,
      callQuality: appointment.callQuality,
      doctorName: appointment.doctorId
        ? `Dr. ${(appointment.doctorId as any).firstName} ${(appointment.doctorId as any).lastName}`
        : 'Doctor',
      patientName: appointment.userId
        ? `${(appointment.userId as any).firstName} ${(appointment.userId as any).lastName}`
        : 'Patient',
      participants: appointment.callParticipants ?? [],
      channelName: appointment.callChannelName ?? null,
    },
  });
});

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


