// services/NotificationService.ts - CENTRALIZED NOTIFICATION LOGIC
import Notification from "../models/notifications";
import { Appointment } from "../models/appointment";
import { emitNotification } from "../index";
import { sendPushNotification } from "../util/sendPushNotification";

export interface NotificationPayload {
  userId: string;
  userType: "User" | "Doctor";
  title: string;
  message: string;
  type: "appointment" | "order" | "article" | "supplement" | "system" | "call_ended" | "new_message" | "chat";
  metadata?: any;
}

export class NotificationService {
  /**
   * ✅ CORE: Create notification with deduplication
   */
  static async create(payload: NotificationPayload) {
    try {
      const { userId, userType, title, message, type, metadata } = payload;

      // ✅ DEDUPLICATION: Check for recent duplicate
      const isDuplicate = await this.isDuplicateNotification(userId, title, message, metadata);
      
      if (isDuplicate) {
        // console.log(`⚠️ [NotificationService] Duplicate notification prevented:`, {
        //   userId,
        //   title,
        //   appointmentId: metadata?.appointmentId,
        // });
        return null;
      }

      // ✅ Create notification in DB
      const notification = await Notification.create({
        userId,
        userType,
        type,
        title,
        message,
        metadata,
        isRead: false,
      });

      // console.log(`✅ [NotificationService] Created notification:`, {
      //   _id: notification._id,
      //   userId,
      //   title,
      //   type,
      // });

      // ✅ Emit via Socket.IO (real-time)
      const notificationObject = {
        _id: notification._id.toString(),
        userId: notification.userId.toString(),
        userType: notification.userType,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        metadata: notification.metadata,
        isRead: notification.isRead,
        createdAt: notification.createdAt,
      };

      const emitted = emitNotification(userId.toString(), notificationObject);
      
      if (emitted) {
        console.log(`📡 [NotificationService] Real-time notification sent to ${userType} ${userId}`);
      } else {
        console.log(`⚠️ [NotificationService] User ${userId} not connected - saved in DB only`);
      }

      // ✅ Send push notification (non-blocking)
      this.sendPushAsync(userId, notification);

      return notification;
    } catch (error) {
      console.error(`❌ [NotificationService] Failed to create notification:`, error);
      throw error;
    }
  }

  /**
   * ✅ DEDUPLICATION: Check for duplicate notifications within time window
   */
  private static async isDuplicateNotification(
    userId: string,
    title: string,
    message: string,
    metadata?: any
  ): Promise<boolean> {
    try {
      const timeWindow = 60 * 1000; // 1 minute window
      const recentCutoff = new Date(Date.now() - timeWindow);

      // Check for exact duplicate (same title, message, appointmentId)
      const duplicate = await Notification.findOne({
        userId,
        title,
        message,
        "metadata.appointmentId": metadata?.appointmentId,
        createdAt: { $gte: recentCutoff },
      });

      return !!duplicate;
    } catch (error) {
      console.error(`❌ [NotificationService] Deduplication check failed:`, error);
      return false; // Fail open - better to send duplicate than miss notification
    }
  }

  /**
   * ✅ APPOINTMENT: Notification sent to patient
   */
  static async notifyAppointmentRequestSent(
    userId: string,
    appointmentId: string,
    doctorName: string,
    scheduledAt: Date
  ) {
    return this.create({
      userId,
      userType: "User",
      title: "Appointment Request Sent",
      message: `Your appointment request with ${doctorName} for ${scheduledAt.toLocaleString()} has been sent. Awaiting confirmation.`,
      type: "appointment",
      metadata: {
        appointmentId,
        doctorName,
        scheduledAt: scheduledAt.toISOString(),
        status: "pending",
      },
    });
  }

  /**
   * ✅ APPOINTMENT: Notification sent to doctor
   */
  static async notifyDoctorNewRequest(
    doctorId: string,
    appointmentId: string,
    patientName: string,
    scheduledAt: Date,
    reason?: string
  ) {
    return this.create({
      userId: doctorId,
      userType: "Doctor",
      title: "New Appointment Request",
      message: `${patientName} has requested an appointment for ${scheduledAt.toLocaleString()}${
        reason ? ` - ${reason}` : ""
      }`,
      type: "appointment",
      metadata: {
        appointmentId,
        patientName,
        scheduledAt: scheduledAt.toISOString(),
        reason,
        status: "pending",
      },
    });
  }

  /**
   * ✅ APPOINTMENT: Confirmed by doctor
   */
static async notifyAppointmentConfirmed(
  userId: string,
  appointmentId: string,
  doctorName: string,
  scheduledAt: Date,
  conversationId?: string   // ← NEW optional param
) {
  return this.create({
    userId,
    userType: "User",
    title: "Appointment Confirmed ✅",
    message: `${doctorName} confirmed your appointment for ${scheduledAt.toLocaleString()}. Your chat room is ready!`,
    type: "appointment",
    metadata: {
      appointmentId,
      doctorName,
      scheduledAt:    scheduledAt.toISOString(),
      status:         "confirmed",
      conversationId: conversationId ?? null,  // ← patient uses this to open chat
    },
  });
}

  /**
   * ✅ APPOINTMENT: Rejected by doctor
   */
  static async notifyAppointmentRejected(
    userId: string,
    appointmentId: string,
    doctorName: string
  ) {
    return this.create({
      userId,
      userType: "User",
      title: "Appointment Declined",
      message: `${doctorName} declined your appointment request.`,
      type: "appointment",
      metadata: {
        appointmentId,
        doctorName,
        status: "rejected",
      },
    });
  }

  /**
   * ✅ APPOINTMENT: Cancelled by doctor
   */
  static async notifyAppointmentCancelledByDoctor(
    userId: string,
    appointmentId: string,
    doctorName: string,
    scheduledAt: Date
  ) {
    return this.create({
      userId,
      userType: "User",
      title: "Appointment Cancelled",
      message: `${doctorName} cancelled your appointment scheduled for ${scheduledAt.toLocaleString()}`,
      type: "appointment",
      metadata: {
        appointmentId,
        doctorName,
        scheduledAt: scheduledAt.toISOString(),
        status: "cancelled",
      },
    });
  }

  /**
   * ✅ APPOINTMENT: Cancelled by patient
   */
  static async notifyAppointmentCancelledByPatient(
    doctorId: string,
    appointmentId: string,
    patientName: string,
    scheduledAt: Date
  ) {
    return this.create({
      userId: doctorId,
      userType: "Doctor",
      title: "Appointment Cancelled by Patient",
      message: `${patientName} cancelled the appointment scheduled for ${scheduledAt.toLocaleString()}`,
      type: "appointment",
      metadata: {
        appointmentId,
        patientName,
        scheduledAt: scheduledAt.toISOString(),
        status: "cancelled",
      },
    });
  }

  /**
   * ✅ APPOINTMENT: Rescheduled by doctor
   */
  static async notifyAppointmentRescheduled(
    userId: string,
    appointmentId: string,
    doctorName: string,
    newScheduledAt: Date
  ) {
    return this.create({
      userId,
      userType: "User",
      title: "Appointment Rescheduled",
      message: `${doctorName} rescheduled your appointment to ${newScheduledAt.toLocaleString()}`,
      type: "appointment",
      metadata: {
        appointmentId,
        doctorName,
        scheduledAt: newScheduledAt.toISOString(),
        status: "rescheduled",
      },
    });
  }

  /**
   * ✅ REMINDER: 15-minute reminder (sent to both)
   */
  static async notifyAppointmentReminder(
    userId: string,
    userType: "User" | "Doctor",
    appointmentId: string,
    otherPartyName: string,
    scheduledAt: Date
  ) {
    return this.create({
      userId,
      userType,
      title: "Appointment Starting Soon ⏰",
      message: `Your appointment with ${otherPartyName} starts in 15 minutes!`,
      type: "appointment",
      metadata: {
        appointmentId,
        scheduledAt: scheduledAt.toISOString(),
        type: "reminder",
      },
    });
  }

  /**
   * ✅ CALL: Video call started
   */
  static async notifyCallStarted(
    userId: string,
    userType: "User" | "Doctor",
    appointmentId: string,
    callerName: string
  ) {
    return this.create({
      userId,
      userType,
      title: "Video Call Starting",
      message: `${callerName} is joining the video call`,
      type: "appointment",
      metadata: {
        appointmentId,
        autoJoin: true,
        fromNotification: true,
      },
    });
  }

  /**
   * ✅ CALL: Auto-ended after time limit
   */
  static async notifyCallAutoEnded(
    userId: string,
    userType: "User" | "Doctor",
    appointmentId: string,
    callDuration: number
  ) {
    return this.create({
      userId,
      userType,
      title: "Call Automatically Ended",
      message: "Your call has been automatically ended as it exceeded the scheduled time.",
      type: "appointment",
      metadata: {
        appointmentId,
        status: "ended",
        callDuration,
        autoEnded: true,
      },
    });
  }

  /**
   * ✅ CALL: Expiry warning (10 min remaining)
   */
  static async notifyCallExpiryWarning(
    userId: string,
    userType: "User" | "Doctor",
    appointmentId: string,
    minutesRemaining: number
  ) {
    return this.create({
      userId,
      userType,
      title: "Call Ending Soon",
      message: `Your call will automatically end in ${minutesRemaining} minutes. Please wrap up your consultation.`,
      type: "appointment",
      metadata: {
        appointmentId,
        minutesRemaining,
      },
    });
  }

  /**
   * ✅ PUSH NOTIFICATION: Send async (non-blocking)
   */
  private static async sendPushAsync(userId: string, notification: any) {
    try {
      await sendPushNotification(userId, notification);
    } catch (error) {
      console.error(`⚠️ [NotificationService] Push notification failed for ${userId}:`, error);
      // Don't throw - push notification failure shouldn't break the flow
    }
  }

  /**
   * ✅ UTILITY: Mark notification flags in appointment
   */
  static async markNotificationSent(
    appointmentId: string,
    flagName: "reminder" | "expiryWarning" | "callStarted" | "callEnded"
  ) {
    try {
      await Appointment.findByIdAndUpdate(appointmentId, {
        $set: { [`notificationsSent.${flagName}`]: true },
      });
      // console.log(`✅ [NotificationService] Marked ${flagName} as sent for ${appointmentId}`);
    } catch (error) {
      console.error(`❌ [NotificationService] Failed to mark notification flag:`, error);
    }
  }

static async notifyNewMessage(
  userId: string,
  userType: "User" | "Doctor",
  senderName: string,
  messageContent: string,
  conversationId: string,
  appointmentId: string   // ← add param
) {
  return this.create({
    userId,
    userType,
    title: `New message from ${senderName}`,
    message: messageContent.length > 100
      ? messageContent.substring(0, 100) + "..."
      : messageContent,
    type: "new_message",   // ← was "system", frontend never matched it
    metadata: {
      conversationId,
      appointmentId,       // ← frontend needs this to navigate
      senderName,
    },
  });
}

/**
 * ✅ NEW: Notify video call request
 */
static async notifyVideoCallRequest(
  userId: string,
  userType: "User" | "Doctor",
  requesterName: string,
  conversationId: string
) {
  return this.create({
    userId,
    userType,
    title: "Video Call Request",
    message: `${requesterName} wants to start a video call`,
    type: "system",
    metadata: {
      conversationId,
      requesterName,
      type: "video_call_request",
    },
  });
}
}