// controllers/videoCallController.ts - ENHANCED VERSION

// controllers/videoCallController.ts - FIXED AUTHORIZATION

import { Request, Response } from 'express';
import asyncHandler from '../middleware/asyncHandler';
import { RtcTokenBuilder, RtcRole } from 'agora-access-token';
import { Appointment } from '../models/appointment';
import { createNotificationForUser } from '../util/sendPushNotification';

const AGORA_APP_ID = process.env.AGORA_APP_ID || '';
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE || '';

// Validate Agora credentials on startup
if (!AGORA_APP_ID || !AGORA_APP_CERTIFICATE) {
  console.error('❌ AGORA_APP_ID and AGORA_APP_CERTIFICATE must be set');
}

/**
 * Helper: Extract MongoDB ObjectId as string
 */
const extractId = (field: any): string => {
  if (!field) return '';
  if (typeof field === 'string') return field;
  if (typeof field === 'object' && field._id) return String(field._id);
  return String(field);
};

/**
 * Generate Agora RTC token for video call
 * @route POST /api/v1/video/token
 * @access Only participants of the appointment (doctor or patient)
 */
export const generateVideoToken = asyncHandler(
  async (req: Request, res: Response) => {
    const { appointmentId } = req.body;
    const requesterId = String(req.auth?.id);
    const role = req.auth?.role;

    console.log('🎥 Video token request:', { appointmentId, requesterId, role });

    if (!appointmentId) {
      res.status(400);
      throw new Error('Appointment ID is required');
    }

    if (!requesterId || !role) {
      res.status(401);
      throw new Error('Authentication required');
    }

    // Fetch appointment
    const appointment = await Appointment.findById(appointmentId)
      .populate('userId', 'firstName lastName email')
      .populate('doctorId', 'firstName lastName email');

    if (!appointment) {
      res.status(404);
      throw new Error('Appointment not found');
    }

    // Extract IDs
    const doctorId = extractId(appointment.doctorId);
    const patientId = extractId(appointment.userId);

    console.log('🔐 Authorization check:', { requesterId, doctorId, patientId });

    // ✅ Role-agnostic check: requester must be doctor or patient
    const isParticipant = requesterId === doctorId || requesterId === patientId;

    if (!isParticipant) {
      console.error('❌ Authorization failed: requester not part of appointment', {
        requesterId,
        doctorId,
        patientId,
      });
      res.status(403);
      throw new Error('You are not authorized to join this call');
    }

    // Appointment must be confirmed
    if (appointment.status !== 'confirmed') {
      res.status(400);
      throw new Error(`Appointment must be confirmed to join call (status: ${appointment.status})`);
    }

    // Time window validation
    const now = new Date();
    const scheduledTime = new Date(appointment.scheduledAt);
    const minutesDiff = Math.floor((scheduledTime.getTime() - now.getTime()) / 60000);

    console.log('⏰ Time check:', { now: now.toISOString(), scheduled: scheduledTime.toISOString(), minutesDiff });

    if (minutesDiff > 15) {
      res.status(400);
      throw new Error(`Call can only be joined 15 minutes before scheduled time. Time remaining: ${minutesDiff} minutes`);
    }
    if (minutesDiff < -120) {
      res.status(400);
      throw new Error('Call window has expired (more than 2 hours past scheduled time)');
    }

    // Generate channel name
    const channelName = `appt_${appointmentId}`;

    // Generate UID from requesterId
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

    const expirationTime = Math.floor(Date.now() / 1000) + 86400; // 24h

    try {
      // Generate Agora token
      const token = RtcTokenBuilder.buildTokenWithUid(
        AGORA_APP_ID,
        AGORA_APP_CERTIFICATE,
        channelName,
        uid,
        RtcRole.PUBLISHER,
        expirationTime
      );

      // Participant names
      const doctorName = appointment.doctorId
        ? `Dr. ${(appointment.doctorId as any).firstName} ${(appointment.doctorId as any).lastName}`
        : 'Doctor';
      const patientName = appointment.userId
        ? `${(appointment.userId as any).firstName} ${(appointment.userId as any).lastName}`
        : 'Patient';

      // Notify the other participant
      const otherUserId = requesterId === doctorId ? patientId : doctorId;
      const userName = requesterId === doctorId ? doctorName : patientName;

      await createNotificationForUser(
        otherUserId,
        'Video Call Started',
        `${userName} has joined the video call`,
        'appointment',
        {
          appointmentId: appointment._id,
          action: 'call_started',
          joinedUserId: requesterId,
        }
      ).catch((err) => console.warn('Failed to send call notification:', err.message));

      // Update appointment metadata
      (appointment as any).callStartedAt = new Date();
      (appointment as any).callStartedBy = role;
      await appointment.save();

      console.log(`✅ Video token generated for ${role} ${requesterId} - Channel: ${channelName}`);

      res.status(200).json({
        success: true,
        data: {
          token,
          channelName,
          uid,
          appId: AGORA_APP_ID,
          expiresAt: new Date(expirationTime * 1000).toISOString(),
          appointment: { id: appointment._id, scheduledAt: appointment.scheduledAt, doctorName, patientName },
        },
      });
    } catch (error: any) {
      console.error('Failed to generate Agora token:', error);
      res.status(500);
      throw new Error('Failed to generate video token. Please try again.');
    }
  }
);

/**
 * @desc End video call and update appointment status
 * @route POST /api/v1/video/end-call
 * @access Doctor | User
 */
export const endVideoCall = asyncHandler(
  async (req: Request, res: Response) => {
    const { appointmentId, callDuration, notes } = req.body;
    const userId = req.auth?.id;
    const role = req.auth?.role;

    console.log('🔴 End call request:', { appointmentId, userId, role });

    if (!appointmentId) {
      res.status(400);
      throw new Error('Appointment ID is required');
    }

    const appointment = await Appointment.findById(appointmentId)
      .populate('userId', 'firstName lastName')
      .populate('doctorId', 'firstName lastName');

    if (!appointment) {
      res.status(404);
      throw new Error('Appointment not found');
    }

    // Extract IDs
    const doctorId = extractId(appointment.doctorId);
    const patientId = extractId(appointment.userId);
    const requesterId = String(userId);

    // Check authorization
    const isDoctor = role === 'Doctor' && doctorId === requesterId;
    const isPatient = role === 'User' && patientId === requesterId;

    if (!isDoctor && !isPatient) {
      console.error('❌ Authorization failed for end call');
      res.status(403);
      throw new Error('You are not authorized to end this call');
    }

    // Update appointment
    appointment.status = 'completed';

    // Only doctors can add medical notes
    if (notes && isDoctor) {
      appointment.notes = appointment.notes
        ? `${appointment.notes}\n\nCall Notes: ${notes}`
        : `Call Notes: ${notes}`;
    }

    // Store call metadata
    if (callDuration && typeof callDuration === 'number') {
      (appointment as any).callDuration = callDuration;
    }

    (appointment as any).callEndedBy = role;
    (appointment as any).callEndedAt = new Date();

    await appointment.save();

    // Notify other participant
    const otherUserId = isDoctor ? patientId : doctorId;
    const userName = isDoctor
      ? `Dr. ${(appointment.doctorId as any).firstName}`
      : (appointment.userId as any).firstName;

    await createNotificationForUser(
      otherUserId,
      'Call Ended',
      `${userName} has ended the video call`,
      'appointment',
      {
        appointmentId: appointment._id,
        action: 'call_ended',
        callDuration,
      }
    ).catch((err) => console.warn('Failed to send end call notification:', err.message));

    console.log(
      `✅ Call ended for appointment ${appointmentId}. Duration: ${callDuration}s, Ended by: ${role}`
    );

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
  }
);

/**
 * @desc Get call status and authorization
 * @route GET /api/v1/video/call-status/:appointmentId
 * @access Doctor | User
 */
export const getCallStatus = asyncHandler(
  async (req: Request, res: Response) => {
    const { appointmentId } = req.params;
    const userId = req.auth?.id;
    const role = req.auth?.role;

    const appointment = await Appointment.findById(appointmentId)
      .populate('userId', 'firstName lastName')
      .populate('doctorId', 'firstName lastName');

    if (!appointment) {
      res.status(404);
      throw new Error('Appointment not found');
    }

    // Extract IDs
    const doctorId = extractId(appointment.doctorId);
    const patientId = extractId(appointment.userId);
    const requesterId = String(userId);

    // Check authorization
    const isAuthorized =
      (role === 'Doctor' && doctorId === requesterId) ||
      (role === 'User' && patientId === requesterId);

    if (!isAuthorized) {
      res.status(403);
      throw new Error('Not authorized to view this call');
    }

    // Calculate time until call
    const now = new Date();
    const scheduledTime = new Date(appointment.scheduledAt);
    const timeDiff = scheduledTime.getTime() - now.getTime();
    const minutesDiff = Math.floor(timeDiff / (1000 * 60));

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
        callDuration: (appointment as any).callDuration,
        doctorName: appointment.doctorId
          ? `Dr. ${(appointment.doctorId as any).firstName} ${
              (appointment.doctorId as any).lastName
            }`
          : 'Doctor',
        patientName: appointment.userId
          ? `${(appointment.userId as any).firstName} ${
              (appointment.userId as any).lastName
            }`
          : 'Patient',
      },
    });
  }
);

/**
 * ✅ NEW: Notify call quality issues
 * @route POST /api/v1/video/report-issue
 * @access Doctor | User
 */
export const reportCallIssue = asyncHandler(
  async (req: Request, res: Response) => {
    const { appointmentId, issueType, description } = req.body;
    const userId = req.auth?.id;

    if (!appointmentId || !issueType) {
      res.status(400);
      throw new Error('Appointment ID and issue type are required');
    }

    const appointment = await Appointment.findById(appointmentId);

    if (!appointment) {
      res.status(404);
      throw new Error('Appointment not found');
    }

    // Store issue report (you might want a separate collection for this)
    console.log(`⚠️ Call issue reported for appointment ${appointmentId}:`, {
      userId,
      issueType,
      description,
      timestamp: new Date(),
    });

    // TODO: Store in database for analytics

    res.status(200).json({
      success: true,
      message: 'Issue reported successfully',
    });
  }
);