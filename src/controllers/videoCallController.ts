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

const extractId = (field: any): string => {
  if (!field) return '';
  if (typeof field === 'string') return field;
  if (typeof field === 'object' && field._id) return String(field._id);
  return String(field);
};

/**
 * Generate Agora RTC token for video call
 */
export const generateVideoToken = asyncHandler(async (req: Request, res: Response) => {
  const { appointmentId } = req.body;
  const userId = req.auth?.id;
  const role = req.auth?.role;

  if (!appointmentId) return res.status(400).json({ message: 'Appointment ID is required' });
  if (!userId || !role) return res.status(401).json({ message: 'Authentication required' });

  const appointment = await Appointment.findById(appointmentId)
    .populate('userId', 'firstName lastName email')
    .populate('doctorId', 'firstName lastName email');

  if (!appointment) return res.status(404).json({ message: 'Appointment not found' });

  const doctorId = extractId(appointment.doctorId);
  const patientId = extractId(appointment.userId);
  const requesterId = String(userId);

  const isParticipant = doctorId === requesterId || patientId === requesterId;
  if (!isParticipant) return res.status(403).json({ message: 'You are not authorized to join this call' });

  // Only confirmed or in-progress appointments can join
  if (appointment.status !== 'confirmed' && appointment.status !== 'in-progress') {
    return res.status(400).json({ message: `Appointment must be confirmed to join call (current status: ${appointment.status})` });
  }

  const now = new Date();
  const scheduledTime = new Date(appointment.scheduledAt);
  const minutesDiff = Math.floor((scheduledTime.getTime() - now.getTime()) / (1000 * 60));

  if (minutesDiff > 15) return res.status(400).json({ message: `Call can only be joined 15 minutes before scheduled time. Time remaining: ${minutesDiff} minutes` });
  if (minutesDiff < -120) return res.status(400).json({ message: 'Call window has expired (more than 2 hours past scheduled time)' });

  const channelName = `appt_${appointmentId}`;

  const generateUid = (id: string): number => {
    try {
      const cleaned = id.replace(/[^a-f0-9]/gi, '');
      const hexStr = cleaned.slice(-8).padStart(8, '0');
      return parseInt(hexStr, 16) % 2147483647 || Math.floor(Math.random() * 2147483647);
    } catch {
      return Math.floor(Math.random() * 2147483647);
    }
  };
  const uid = generateUid(requesterId);
  const expirationTime = Math.floor(Date.now() / 1000) + 86400;

  try {
    const token = RtcTokenBuilder.buildTokenWithUid(
      AGORA_APP_ID,
      AGORA_APP_CERTIFICATE,
      channelName,
      uid,
      RtcRole.PUBLISHER,
      expirationTime
    );

    // Mark call as in-progress if not already
    if (!appointment.callStartedAt) {
      appointment.callStartedAt = new Date();
      appointment.callStartedBy = role as any;
      appointment.status = 'in-progress';
      await appointment.save();
    }

    // Notify the other participant
    const otherUserId = doctorId === requesterId ? patientId : doctorId;
    const userName = role === 'Doctor'
      ? `Dr. ${(appointment.doctorId as any).firstName} ${(appointment.doctorId as any).lastName}`
      : `${(appointment.userId as any).firstName} ${(appointment.userId as any).lastName}`;

    await createNotificationForUser(
      otherUserId,
      'Video Call Started',
      `${userName} has joined the video call`,
      'appointment',
      { appointmentId: appointment._id, action: 'call_started', joinedUserId: requesterId }
    ).catch(err => console.warn('Failed to send call notification:', err.message));

    res.status(200).json({
      success: true,
      data: {
        token,
        channelName,
        uid,
        appId: AGORA_APP_ID,
        expiresAt: new Date(expirationTime * 1000).toISOString(),
        appointment: {
          id: appointment._id,
          scheduledAt: appointment.scheduledAt,
          doctorName: `Dr. ${(appointment.doctorId as any).firstName} ${(appointment.doctorId as any).lastName}`,
          patientName: `${(appointment.userId as any).firstName} ${(appointment.userId as any).lastName}`,
          consultationType: appointment.consultationType,
        },
      },
    });
  } catch (error: any) {
    console.error('Failed to generate Agora token:', error);
    res.status(500).json({ message: 'Failed to generate video token. Please try again.' });
  }
});

/**
 * End video call controller
 */
export const endVideoCall = asyncHandler(async (req: Request, res: Response) => {
  const { appointmentId, callDuration, notes, callQuality } = req.body;
  const userId = req.auth?.id;
  const role = req.auth?.role;

  if (!appointmentId) return res.status(400).json({ message: 'Appointment ID is required' });

  const appointment = await Appointment.findById(appointmentId)
    .populate('userId', 'firstName lastName')
    .populate('doctorId', 'firstName lastName');

  if (!appointment) return res.status(404).json({ message: 'Appointment not found' });

  const doctorId = extractId(appointment.doctorId);
  const patientId = extractId(appointment.userId);
  const requesterId = String(userId);

  const isDoctor = role === 'Doctor' && doctorId === requesterId;
  const isPatient = role === 'User' && patientId === requesterId;

  if (!isDoctor && !isPatient) return res.status(403).json({ message: 'You are not authorized to end this call' });

  appointment.status = 'completed';
  appointment.callEndedBy = role as any;
  appointment.callEndedAt = new Date();
  if (typeof callDuration === 'number') appointment.callDuration = callDuration;
  if (callQuality) appointment.callQuality = callQuality;

  // Only doctors can add notes
  if (notes && isDoctor) {
    appointment.notes = appointment.notes
      ? `${appointment.notes}\n\nCall Notes: ${notes}`
      : `Call Notes: ${notes}`;
  }

  await appointment.save();

  const otherUserId = isDoctor ? patientId : doctorId;
  const userName = isDoctor
    ? `Dr. ${(appointment.doctorId as any).firstName}`
    : `${(appointment.userId as any).firstName}`;

  await createNotificationForUser(
    otherUserId,
    'Call Ended',
    `${userName} has ended the video call`,
    'appointment',
    { appointmentId: appointment._id, action: 'call_ended', callDuration }
  ).catch(err => console.warn('Failed to send end call notification:', err.message));

  res.status(200).json({
    success: true,
    message: 'Call ended successfully',
    data: {
      appointmentId: appointment._id,
      status: appointment.status,
      callDuration,
      endedBy: role,
    },
  });
});

/**
 * Get call status
 */
export const getCallStatus = asyncHandler(async (req: Request, res: Response) => {
  const { appointmentId } = req.params;
  const userId = req.auth?.id;
  const role = req.auth?.role;

  const appointment = await Appointment.findById(appointmentId)
    .populate('userId', 'firstName lastName')
    .populate('doctorId', 'firstName lastName');

  if (!appointment) return res.status(404).json({ message: 'Appointment not found' });

  const doctorId = extractId(appointment.doctorId);
  const patientId = extractId(appointment.userId);
  const requesterId = String(userId);

  const isAuthorized = (role === 'Doctor' && doctorId === requesterId) || (role === 'User' && patientId === requesterId);
  if (!isAuthorized) return res.status(403).json({ message: 'Not authorized to view this call' });

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
