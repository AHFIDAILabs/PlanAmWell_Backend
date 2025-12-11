// controllers/videoCallController.ts

import { Request, Response } from 'express';
import asyncHandler from '../middleware/asyncHandler';
import { RtcTokenBuilder, RtcRole } from 'agora-access-token';
import { Appointment } from '../models/appointment';

const AGORA_APP_ID = process.env.AGORA_APP_ID || '';
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE || '';



// Validate Agora credentials on startup
if (!AGORA_APP_ID || !AGORA_APP_CERTIFICATE) {
  console.error('❌ AGORA_APP_ID and AGORA_APP_CERTIFICATE must be set in environment variables');
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
      .populate('userId', 'firstName lastName')
      .populate('doctorId', 'firstName lastName');

    if (!appointment) {
      res.status(404);
      throw new Error('Appointment not found');
    }

    // Check if user is authorized (either doctor or patient)
    const isDoctor = role === 'Doctor' && 
      appointment.doctorId.toString() === userId;
    const isPatient = role === 'User' && 
      appointment.userId.toString() === userId;

    if (!isDoctor && !isPatient) {
      res.status(403);
      throw new Error('You are not authorized to join this call');
    }

    // Check if appointment is confirmed
    if (appointment.status !== 'confirmed') {
      res.status(400);
      throw new Error(`Appointment must be confirmed to join call (current status: ${appointment.status})`);
    }

    // Check if call time is valid (15 min before to 1 hour after)
    const now = new Date();
    const scheduledTime = new Date(appointment.scheduledAt);
    const timeDiff = scheduledTime.getTime() - now.getTime();
    const minutesDiff = Math.floor(timeDiff / (1000 * 60));

    if (minutesDiff > 15) {
      res.status(400);
      throw new Error(`Call can only be joined 15 minutes before scheduled time. Time until call: ${minutesDiff} minutes`);
    }

    if (minutesDiff < -60) {
      res.status(400);
      throw new Error('Call window has expired (more than 1 hour past scheduled time)');
    }

    // Generate channel name (unique per appointment)
    const channelName = `appt_${appointmentId}`;
    
    // Generate consistent UID from userId
    const uidString = userId.replace(/[^a-f0-9]/gi, '').slice(-8);
    const uid = parseInt(uidString, 16) % 2147483647; // Ensure 32-bit integer
    
    // Token expires in 24 hours
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

      res.status(200).json({
        success: true,
        data: {
          token,
          channelName,
          uid,
          appId: AGORA_APP_ID,
          expiresAt: new Date(expirationTime * 1000).toISOString(),
        },
      });
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
 * @access Doctor
 */
export const endVideoCall = asyncHandler(
  async (req: Request, res: Response) => {
    const { appointmentId, callDuration, notes } = req.body;
    const userId = req.auth?.id;
    const role = req.auth?.role;

    // Only doctors can end calls
    if (role !== 'Doctor') {
      res.status(403);
      throw new Error('Only doctors can officially end calls');
    }

    // Validate input
    if (!appointmentId) {
      res.status(400);
      throw new Error('Appointment ID is required');
    }

    const appointment = await Appointment.findById(appointmentId);
    
    if (!appointment) {
      res.status(404);
      throw new Error('Appointment not found');
    }

    if (appointment.doctorId.toString() !== userId) {
      res.status(403);
      throw new Error('You are not authorized to end this call');
    }

    // Update appointment
    appointment.status = 'completed';
    
    if (notes) {
      appointment.notes = notes;
    }

    // Store call duration if provided
    if (callDuration && typeof callDuration === 'number') {
      (appointment as any).callDuration = callDuration;
    }

    await appointment.save();

    // TODO: Log to analytics/billing system
    console.log(`Call completed for appointment ${appointmentId}. Duration: ${callDuration}s`);

    res.status(200).json({
      success: true,
      message: 'Call ended successfully',
      data: {
        appointmentId: appointment._id,
        status: appointment.status,
        callDuration,
      },
    });
  }
);
