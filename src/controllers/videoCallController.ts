// controllers/videoCallController.ts - ENHANCED VERSION

import { Request, Response } from 'express';
import asyncHandler from '../middleware/asyncHandler';
import { RtcTokenBuilder, RtcRole } from 'agora-access-token';
import { Appointment } from '../models/appointment';
import { createNotificationForUser } from '../util/sendPushNotification';
import { emitNotification } from '../index';

const AGORA_APP_ID = process.env.AGORA_APP_ID || '';
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE || '';

// Validate Agora credentials on startup
if (!AGORA_APP_ID || !AGORA_APP_CERTIFICATE) {
  console.error('❌ AGORA_APP_ID and AGORA_APP_CERTIFICATE must be set in environment variables');
  process.exit(1); // ✅ Exit if credentials missing
}

/**
 * @desc Generate Agora RTC token for video call
 * @route POST /api/v1/video/token
 * @access Doctor | User (with valid appointment)
 */
export const generateVideoToken = asyncHandler(
  async (req: Request, res: Response) => {
    const { appointmentId } = req.body;
    const userId = req.auth?.id;
    const role = req.auth?.role;

    // Input validation
    if (!appointmentId) {
      res.status(400);
      throw new Error('Appointment ID is required');
    }

    if (!userId || !role) {
      res.status(401);
      throw new Error('Authentication required');
    }

    // Verify appointment exists and populate required fields
    const appointment = await Appointment.findById(appointmentId)
      .populate('userId', 'firstName lastName email')
      .populate('doctorId', 'firstName lastName email');

    if (!appointment) {
      res.status(404);
      throw new Error('Appointment not found');
    }

    // ✅ FIX: Proper type checking for populated fields
    const doctorId = typeof appointment.doctorId === 'object' 
      ? (appointment.doctorId as any)._id 
      : appointment.doctorId;
    const patientId = typeof appointment.userId === 'object'
      ? (appointment.userId as any)._id
      : appointment.userId;

    // Check if user is authorized (either doctor or patient)
    const isDoctor = role === 'Doctor' && doctorId.toString() === userId;
    const isPatient = role === 'User' && patientId.toString() === userId;

    if (!isDoctor && !isPatient) {
      res.status(403);
      throw new Error('You are not authorized to join this call');
    }

    // Check if appointment is confirmed
    if (appointment.status !== 'confirmed') {
      res.status(400);
      throw new Error(`Appointment must be confirmed to join call (current status: ${appointment.status})`);
    }

    // ✅ IMPROVED: More flexible time window validation
    const now = new Date();
    const scheduledTime = new Date(appointment.scheduledAt);
    const timeDiff = scheduledTime.getTime() - now.getTime();
    const minutesDiff = Math.floor(timeDiff / (1000 * 60));

    // Allow joining 15 minutes before
    if (minutesDiff > 15) {
      res.status(400);
      throw new Error(`Call can only be joined 15 minutes before scheduled time. Time remaining: ${minutesDiff} minutes`);
    }

    // Allow up to 2 hours after scheduled time (more flexible)
    if (minutesDiff < -120) {
      res.status(400);
      throw new Error('Call window has expired (more than 2 hours past scheduled time)');
    }

    // Generate channel name (unique per appointment)
    const channelName = `appt_${appointmentId}`;
    
    // ✅ IMPROVED: Better UID generation with fallback
    const generateUid = (id: string): number => {
      try {
        // Remove hyphens and take last 8 hex chars
        const cleaned = id.replace(/[^a-f0-9]/gi, '');
        const hexStr = cleaned.slice(-8).padStart(8, '0');
        const uid = parseInt(hexStr, 16) % 2147483647;
        return uid || Math.floor(Math.random() * 2147483647);
      } catch {
        return Math.floor(Math.random() * 2147483647);
      }
    };

    const uid = generateUid(userId);
    
    // ✅ Token expires in 24 hours
    const expirationTime = Math.floor(Date.now() / 1000) + 86400;
    
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

      // ✅ NEW: Notify the other participant that someone joined
      const otherUserId = isDoctor ? patientId.toString() : doctorId.toString();
      const userName = isDoctor 
        ? `Dr. ${(appointment.doctorId as any).firstName} ${(appointment.doctorId as any).lastName}`
        : `${(appointment.userId as any).firstName} ${(appointment.userId as any).lastName}`;

      // Send notification to other participant
      await createNotificationForUser(
        otherUserId,
        'Video Call Started',
        `${userName} has joined the video call`,
        'appointment',
        {
          appointmentId: appointment._id,
          action: 'call_started',
          joinedUserId: userId,
        }
      );

      // ✅ NEW: Update appointment status to "in-progress"
      if (appointment.status === 'confirmed') {
        appointment.status = 'in-progress' as any;
        await appointment.save();
      }

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
          },
        },
      });

      console.log(`✅ Video token generated for user ${userId} (${role}) - Channel: ${channelName}`);
    } catch (error) {
      console.error('Failed to generate Agora token:', error);
      res.status(500);
      throw new Error('Failed to generate video token. Please contact support.');
    }
  }
);

/**
 * @desc End video call and update appointment status
 * @route POST /api/v1/video/end-call
 * @access Doctor | User (both can end call)
 */
export const endVideoCall = asyncHandler(
  async (req: Request, res: Response) => {
    const { appointmentId, callDuration, notes, callQuality } = req.body;
    const userId = req.auth?.id;
    const role = req.auth?.role;

    // Validate input
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

    // ✅ IMPROVED: Both doctor and patient can end call
    const doctorId = typeof appointment.doctorId === 'object'
      ? (appointment.doctorId as any)._id
      : appointment.doctorId;
    const patientId = typeof appointment.userId === 'object'
      ? (appointment.userId as any)._id
      : appointment.userId;

    const isDoctor = role === 'Doctor' && doctorId.toString() === userId;
    const isPatient = role === 'User' && patientId.toString() === userId;

    if (!isDoctor && !isPatient) {
      res.status(403);
      throw new Error('You are not authorized to end this call');
    }

    // ✅ Update appointment status
    appointment.status = 'completed';
    
    // ✅ Only doctors can add medical notes
    if (notes && isDoctor) {
      appointment.notes = appointment.notes 
        ? `${appointment.notes}\n\nCall Notes: ${notes}`
        : `Call Notes: ${notes}`;
    }

    // ✅ Store call metadata
    if (callDuration && typeof callDuration === 'number') {
      (appointment as any).callDuration = callDuration;
    }

    if (callQuality) {
      (appointment as any).callQuality = callQuality;
    }

    (appointment as any).callEndedBy = role;
    (appointment as any).callEndedAt = new Date();

    await appointment.save();

    // ✅ Notify the other participant
    const otherUserId = isDoctor ? patientId.toString() : doctorId.toString();
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
    );

    console.log(`✅ Call completed for appointment ${appointmentId}. Duration: ${callDuration}s, Ended by: ${role}`);

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
 * ✅ NEW: Get call status
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

    // Verify authorization
    const doctorId = typeof appointment.doctorId === 'object'
      ? (appointment.doctorId as any)._id
      : appointment.doctorId;
    const patientId = typeof appointment.userId === 'object'
      ? (appointment.userId as any)._id
      : appointment.userId;

    const isAuthorized = 
      (role === 'Doctor' && doctorId.toString() === userId) ||
      (role === 'User' && patientId.toString() === userId);

    if (!isAuthorized) {
      res.status(403);
      throw new Error('Not authorized');
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
        callDuration: (appointment as any).callDuration,
        doctorName: `Dr. ${(appointment.doctorId as any).firstName} ${(appointment.doctorId as any).lastName}`,
        patientName: `${(appointment.userId as any).firstName} ${(appointment.userId as any).lastName}`,
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