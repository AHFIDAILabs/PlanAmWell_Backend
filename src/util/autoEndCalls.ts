import { Appointment } from '../models/appointment';
import { createNotificationForUser } from './sendPushNotification';
import { CALL_GRACE_MINUTES } from "../config/callConfig";

/**
 * Helper to extract ID from any field
 */
const extractId = (field: any): string => {
  if (!field) return '';
  if (typeof field === 'string') return field;
  if (typeof field === 'object' && field._id) return String(field._id);
  return String(field);
};



/**
 * Auto-end calls that have exceeded their scheduled time + grace period
 * Run this every 5-10 minutes via cron
 */
export const autoEndExpiredCalls = async () => {
  try {
    const now = new Date();
    
    // Find all calls that are currently in progress or ringing
    const activeCalls = await Appointment.find({
      callStatus: { $in: ['ringing', 'in-progress'] },
      scheduledAt: { $lt: now }, // Appointment time has passed
    })
      .populate('doctorId', 'firstName lastName')
      .populate('userId', 'firstName lastName');

    console.log(`🔍 Checking ${activeCalls.length} active calls for auto-end...`);

    let endedCount = 0;

    for (const appointment of activeCalls) {
      const scheduledTime = new Date(appointment.scheduledAt);
      const duration = appointment.duration || 30; // Default 30 minutes
      
      // Calculate expected end time (scheduled time + duration + 2 hour grace period)
    const expectedEndTime = new Date(
  scheduledTime.getTime() +
    duration * 60 * 1000 +
    CALL_GRACE_MINUTES * 60 * 1000
);

      // If current time exceeds expected end time, auto-end the call
      if (now > expectedEndTime) {
        console.log(`⏰ Auto-ending expired call for appointment ${appointment._id}`);

        // Calculate actual call duration
        const callStartTime = appointment.callStartedAt || appointment.scheduledAt;
        const actualDuration = Math.floor((now.getTime() - new Date(callStartTime).getTime()) / 1000);

        if (appointment.callStatus === "ended") {
  continue;
}

        // Update appointment
        appointment.callStatus = 'ended';
        appointment.callEndedAt = now;
        appointment.callEndedBy = 'system' as any;
        appointment.callDuration = actualDuration;
        appointment.status = 'completed';

        await appointment.save();

        // Extract IDs
        const doctorId = extractId(appointment.doctorId);
        const patientId = extractId(appointment.userId);

        // Notify both parties
        const notificationTitle = 'Call Automatically Ended';
        const notificationMessage = 'Your call has been automatically ended as it exceeded the scheduled time.';

        try {
          // Notify doctor
          await createNotificationForUser(
            doctorId,
            notificationTitle,
            notificationMessage,
            'appointment',
            {
              appointmentId: appointment._id,
              status: 'ended',
              callDuration: actualDuration,
              autoEnded: true,
            }
          );

          // Notify patient
          await createNotificationForUser(
            patientId,
            notificationTitle,
            notificationMessage,
            'appointment',
            {
              appointmentId: appointment._id,
              status: 'ended',
              callDuration: actualDuration,
              autoEnded: true,
            }
          );

          console.log(`✅ Auto-ended call and notified both parties`);
        } catch (notifError) {
          console.error('Failed to send auto-end notifications:', notifError);
        }

        endedCount++;
      }
    }

    if (endedCount > 0) {
      console.log(`✅ Auto-ended ${endedCount} expired calls`);
    } else {
      console.log(`✓ No expired calls found`);
    }

    return { success: true, endedCount };
  } catch (error) {
    console.error('❌ Error in autoEndExpiredCalls:', error);
    return { success: false, error };
  }
};

/**
 * Check for calls that are about to expire and send warnings
 * Run this every 5 minutes
 */
export const sendCallExpiryWarnings = async () => {
  try {
    const now = new Date();
    
    // Find calls that will expire in the next 10 minutes
    const soonToExpireCalls = await Appointment.find({
      callStatus: 'in-progress',
    })
      .populate('doctorId', 'firstName lastName')
      .populate('userId', 'firstName lastName');

    let warningCount = 0;

    for (const appointment of soonToExpireCalls) {
      const scheduledTime = new Date(appointment.scheduledAt);
      const duration = appointment.duration || 30;
      
      // Calculate expected end time
    const expectedEndTime = new Date(
  scheduledTime.getTime() +
    duration * 60 * 1000 +
    CALL_GRACE_MINUTES * 60 * 1000
);

      const timeUntilExpiry = expectedEndTime.getTime() - now.getTime();
      const minutesUntilExpiry = Math.floor(timeUntilExpiry / (1000 * 60));

      // Send warning if 10 minutes or less remaining
      if (minutesUntilExpiry > 0 && minutesUntilExpiry <= 10 && !appointment.expiryWarningSent) {
        console.log(`⚠️ Sending expiry warning for appointment ${appointment._id}`);

        const doctorId = extractId(appointment.doctorId);
        const patientId = extractId(appointment.userId);

        const warningMessage = `Your call will automatically end in ${minutesUntilExpiry} minutes. Please wrap up your consultation.`;

        try {
          // Notify both parties
          await createNotificationForUser(
            doctorId,
            'Call Ending Soon',
            warningMessage,
            'appointment',
            {
              appointmentId: appointment._id,
              minutesRemaining: minutesUntilExpiry,
            }
          );

          await createNotificationForUser(
            patientId,
            'Call Ending Soon',
            warningMessage,
            'appointment',
            {
              appointmentId: appointment._id,
              minutesRemaining: minutesUntilExpiry,
            }
          );

          appointment.expiryWarningSent = true;
          await appointment.save();

          warningCount++;
        } catch (notifError) {
          console.error('Failed to send expiry warning:', notifError);
        }
      }
    }

    if (warningCount > 0) {
      console.log(`✅ Sent ${warningCount} expiry warnings`);
    }

    return { success: true, warningCount };
  } catch (error) {
    console.error('❌ Error in sendCallExpiryWarnings:', error);
    return { success: false, error };
  }
};