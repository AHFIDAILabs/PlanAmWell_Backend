// utils/autoEndExpiredCalls.ts - UPGRADED WITH NOTIFICATION SERVICE
import { Appointment } from '../models/appointment';
import { NotificationService } from '../services/NotificationService';
import { CALL_GRACE_MINUTES } from "../config/callConfig";

const extractId = (field: any): string => {
  if (!field) return '';
  if (typeof field === 'string') return field;
  if (typeof field === 'object' && field._id) return String(field._id);
  return String(field);
};

/**
 * ✅ Auto-end calls that have exceeded their scheduled time + grace period
 * Run this every 5-10 minutes via cron
 */
export const autoEndExpiredCalls = async () => {
  try {
    const now = new Date();
    
    const activeCalls = await Appointment.find({
      callStatus: { $in: ['ringing', 'in-progress'] },
      scheduledAt: { $lt: now },
    })
      .populate('doctorId', 'firstName lastName')
      .populate('userId', 'name userImage');

    // console.log(`🔍 [AutoEnd] Checking ${activeCalls.length} active calls for auto-end...`);

    let endedCount = 0;

    for (const appointment of activeCalls) {
      const scheduledTime = new Date(appointment.scheduledAt);
      const duration = appointment.duration || 30;
      
      const expectedEndTime = new Date(
        scheduledTime.getTime() +
          duration * 60 * 1000 +
          CALL_GRACE_MINUTES * 60 * 1000
      );

      if (now > expectedEndTime) {
        // console.log(`⏰ [AutoEnd] Auto-ending expired call for appointment ${appointment._id}`);

        const callStartTime = appointment.callStartedAt || appointment.scheduledAt;
        const actualDuration = Math.floor((now.getTime() - new Date(callStartTime).getTime()) / 1000);

        if (appointment.callStatus === "ended") {
          continue;
        }

        appointment.callStatus = 'ended';
        appointment.callEndedAt = now;
        appointment.callEndedBy = 'system' as any;
        appointment.callDuration = actualDuration;
        appointment.status = 'completed';

        await appointment.save();

        const doctorId = extractId(appointment.doctorId);
        const patientId = extractId(appointment.userId);
        const appointmentId = String(appointment._id);

        try {
          // ✅ Notify doctor
          await NotificationService.notifyCallAutoEnded(
            doctorId,
            'Doctor',
            appointmentId,
            actualDuration
          );

          // ✅ Notify patient
          await NotificationService.notifyCallAutoEnded(
            patientId,
            'User',
            appointmentId,
            actualDuration
          );

          // console.log(`✅ [AutoEnd] Auto-ended call and notified both parties`);
        } catch (notifError) {
          console.error('[AutoEnd] Failed to send auto-end notifications:', notifError);
        }

        endedCount++;
      }
    }

    if (endedCount > 0) {
      console.log(`✅ [AutoEnd] Auto-ended ${endedCount} expired calls`);
    } else {
      console.log(`✓ [AutoEnd] No expired calls found`);
    }

    return { success: true, endedCount };
  } catch (error) {
    console.error('❌ [AutoEnd] Error in autoEndExpiredCalls:', error);
    return { success: false, error };
  }
};

/**
 * ✅ Check for calls that are about to expire and send warnings
 * Run this every 5 minutes
 */
export const sendCallExpiryWarnings = async () => {
  try {
    const now = new Date();
    
    const soonToExpireCalls = await Appointment.find({
      callStatus: 'in-progress',
      "notificationsSent.expiryWarning": { $ne: true }, // ✅ Prevent duplicate warnings
    })
      .populate('doctorId', 'firstName lastName')
      .populate('userId', 'name userImage');

    let warningCount = 0;

    for (const appointment of soonToExpireCalls) {
      const scheduledTime = new Date(appointment.scheduledAt);
      const duration = appointment.duration || 30;
      
      const expectedEndTime = new Date(
        scheduledTime.getTime() +
          duration * 60 * 1000 +
          CALL_GRACE_MINUTES * 60 * 1000
      );

      const timeUntilExpiry = expectedEndTime.getTime() - now.getTime();
      const minutesUntilExpiry = Math.floor(timeUntilExpiry / (1000 * 60));

      // Send warning if 10 minutes or less remaining
      if (minutesUntilExpiry > 0 && minutesUntilExpiry <= 10) {
        // console.log(`⚠️ [ExpiryWarning] Sending expiry warning for appointment ${appointment._id}`);

        const doctorId = extractId(appointment.doctorId);
        const patientId = extractId(appointment.userId);
        const appointmentId = String(appointment._id);

        try {
          // ✅ Notify both parties
          await NotificationService.notifyCallExpiryWarning(
            doctorId,
            'Doctor',
            appointmentId,
            minutesUntilExpiry
          );

          await NotificationService.notifyCallExpiryWarning(
            patientId,
            'User',
            appointmentId,
            minutesUntilExpiry
          );

          // ✅ Mark warning as sent
          await NotificationService.markNotificationSent(appointmentId, 'expiryWarning');

          warningCount++;
        } catch (notifError) {
          console.error('[ExpiryWarning] Failed to send expiry warning:', notifError);
        }
      }
    }

    if (warningCount > 0) {
      console.log(`✅ [ExpiryWarning] Sent ${warningCount} expiry warnings`);
    }

    return { success: true, warningCount };
  } catch (error) {
    console.error('❌ [ExpiryWarning] Error in sendCallExpiryWarnings:', error);
    return { success: false, error };
  }
};