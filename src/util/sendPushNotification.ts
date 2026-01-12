// util/sendPushNotification.ts - UPDATED WITH INCOMING CALL RINGTONE SUPPORT
import Expo from "expo-server-sdk";
import { User } from "../models/user";
import { Doctor } from "../models/doctor";
import Notification, { NotificationDocument } from "../models/notifications";

const expo = new Expo();

/**
 * ✅ Send INCOMING CALL push notification (triggers native ringtone on user's phone)
 */
export async function sendIncomingCallPushNotification(
  recipientUserId: string,
  callData: {
    appointmentId: string;
    callerName: string;
    callerImage?: string;
    callerType: "Doctor" | "User" | string;
    channelName: string;
  }
) {
  try {
    // Find recipient user (could be User or Doctor)
    let recipient = await User.findById(recipientUserId).select("expoPushTokens");

    if (!recipient) {
      recipient = await Doctor.findById(recipientUserId).select("expoPushTokens");
    }

    if (!recipient || !recipient.expoPushTokens?.length) {
      console.log(`[IncomingCall] No push tokens found for user ${recipientUserId}`);
      return;
    }

    // Filter valid Expo push tokens
    const validTokens = recipient.expoPushTokens.filter((token: string) => 
      Expo.isExpoPushToken(token)
    );

    if (!validTokens.length) {
      console.log(`[IncomingCall] No valid Expo tokens for user ${recipientUserId}`);
      return;
    }

    // ✅ CRITICAL: Configure push notification for INCOMING CALL
    // This will trigger the phone's native ringtone and show full-screen call UI
    const messages = validTokens.map((token: string) => ({
      to: token,
      sound: "default", // Use system default ringtone
      title: "📞 Incoming Call",
      body: `${callData.callerName} is calling you`,
      data: {
        type: "incoming_call",
        appointmentId: callData.appointmentId,
        callerName: callData.callerName,
        callerImage: callData.callerImage,
        callerType: callData.callerType,
        channelName: callData.channelName,
        timestamp: new Date().toISOString(),
      },
      priority: "high" as const, // High priority for immediate delivery
      channelId: "incoming-calls", // Android notification channel
      categoryIdentifier: "INCOMING_CALL", // iOS category for call UI
      
      // ✅ iOS specific settings for call-like behavior
      badge: 1,
      ttl: 60, // Time to live: 60 seconds
      
      // ✅ Android specific settings
      ...(process.env.NODE_ENV === "production" && {
        android: {
          priority: "high",
          sound: "default",
          channelId: "incoming-calls",
          vibrate: [0, 250, 250, 250],
        },
      }),
    }));

    // Send push notifications in chunks
    for (const chunk of expo.chunkPushNotifications(messages)) {
      try {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        console.log(`[IncomingCall] ✅ Sent ${tickets.length} call notifications to user ${recipientUserId}`);
        
        // Log any errors
        tickets.forEach((ticket, index) => {
          if (ticket.status === 'error') {
            console.error(`[IncomingCall] Error sending to token ${index}:`, ticket.message);
          }
        });
      } catch (err) {
        console.error("[IncomingCall] Error sending push notification chunk:", err);
      }
    }

    console.log(`🔔 Incoming call push notification sent - ${callData.callerName} → User ${recipientUserId}`);
    console.log(`   Device should now be ringing with native ringtone`);
    
  } catch (error) {
    console.error("[IncomingCall] Failed to send push notification:", error);
    throw error;
  }
}

/**
 * ✅ Send CALL MISSED push notification
 */
export async function sendMissedCallPushNotification(
  recipientUserId: string,
  callData: {
    appointmentId: string;
    callerName: string;
    callerImage?: string;
    timestamp: Date;
  }
) {
  try {
    let recipient = await User.findById(recipientUserId).select("expoPushTokens");

    if (!recipient) {
      recipient = await Doctor.findById(recipientUserId).select("expoPushTokens");
    }

    if (!recipient || !recipient.expoPushTokens?.length) {
      return;
    }

    const messages = recipient.expoPushTokens
      .filter((token: string) => Expo.isExpoPushToken(token))
      .map((token: string) => ({
        to: token,
        sound: "default" as const,
        title: "📵 Missed Call",
        body: `You missed a call from ${callData.callerName}`,
        data: {
          type: "missed_call",
          appointmentId: callData.appointmentId,
          callerName: callData.callerName,
          callerImage: callData.callerImage,
          timestamp: callData.timestamp.toISOString(),
        },
        priority: "high" as const,
        badge: 1,
      }));

    if (!messages.length) return;

    for (const chunk of expo.chunkPushNotifications(messages)) {
      try {
        await expo.sendPushNotificationsAsync(chunk);
      } catch (err) {
        console.error("[MissedCall] Error sending push notification:", err);
      }
    }

    console.log(`📵 Missed call notification sent to user ${recipientUserId}`);
  } catch (error) {
    console.error("[MissedCall] Failed:", error);
  }
}

/**
 * ✅ Send CALL ENDED push notification
 */
export async function sendCallEndedPushNotification(
  recipientUserId: string,
  callData: {
    appointmentId: string;
    duration: number;
    endedBy: string;
  }
) {
  try {
    let recipient = await User.findById(recipientUserId).select("expoPushTokens");

    if (!recipient) {
      recipient = await Doctor.findById(recipientUserId).select("expoPushTokens");
    }

    if (!recipient || !recipient.expoPushTokens?.length) {
      return;
    }

    const durationMin = Math.floor(callData.duration / 60);
    const durationSec = callData.duration % 60;

    const messages = recipient.expoPushTokens
      .filter((token: string) => Expo.isExpoPushToken(token))
      .map((token: string) => ({
        to: token,
        sound: "default" as const,
        title: "Call Ended",
        body: `Call duration: ${durationMin}m ${durationSec}s`,
        data: {
          type: "call_ended",
          appointmentId: callData.appointmentId,
          duration: callData.duration,
          endedBy: callData.endedBy,
        },
        priority: "normal" as const,
      }));

    if (!messages.length) return;

    for (const chunk of expo.chunkPushNotifications(messages)) {
      try {
        await expo.sendPushNotificationsAsync(chunk);
      } catch (err) {
        console.error("[CallEnded] Error sending push notification:", err);
      }
    }

    console.log(`✅ Call ended notification sent to user ${recipientUserId}`);
  } catch (error) {
    console.error("[CallEnded] Failed:", error);
  }
}

/**
 * ✅ Send regular push notification (existing functionality)
 */
export async function sendPushNotification(
  userId: string,
  notification: NotificationDocument
) {
  try {
    let user = await User.findById(userId).select("expoPushTokens");

    if (!user) {
      user = await Doctor.findById(userId).select("expoPushTokens");
    }

    if (!user || !user.expoPushTokens?.length) {
      return;
    }

    const messages = user.expoPushTokens
      .filter((token: string) => Expo.isExpoPushToken(token))
      .map((token: string) => ({
        to: token,
        sound: "default" as const,
        title: notification.title,
        body: notification.message,
        data: notification.metadata ?? {},
      }));

    if (!messages.length) {
      return;
    }

    for (const chunk of expo.chunkPushNotifications(messages)) {
      try {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
      } catch (err) {
        console.error("[PushNotification] Error sending push notifications:", err);
      }
    }
  } catch (error) {
    console.error("[PushNotification] Failed:", error);
  }
}

/**
 * 🔔 Create notification for ANY user (User or Doctor)
 */
export const createNotificationForUser = async (
  userId: string,
  userType: "User" | "Doctor",
  title: string,
  message: string,
  type:
    | "appointment"
    | "order"
    | "article"
    | "supplement"
    | "system"
    | "call_ended",
  metadata?: any
) => {
  try {
    const notification = await Notification.create({
      userId,
      userType,
      type,
      title,
      message,
      metadata,
      isRead: false,
    });

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

    // Send push notification (non-blocking)
    sendPushNotification(userId.toString(), notification).catch(console.error);

    return notification;
  } catch (error) {
    console.error(`❌ Failed to create notification for ${userId}:`, error);
    throw error;
  }
};

/**
 * 🔔 Create appointment notification
 */
export const createAppointmentNotification = async (
  userId: string,
  userType: "User" | "Doctor",
  appointmentId: string,
  type: "confirmed" | "rejected" | "cancelled" | "reminder",
  doctorName: string,
  scheduledAt: Date
) => {
  const messages = {
    confirmed: `Dr. ${doctorName} confirmed your appointment for ${scheduledAt.toLocaleString()}`,
    rejected: `Dr. ${doctorName} declined your appointment request. Please choose another time.`,
    cancelled: `Your appointment with Dr. ${doctorName} has been cancelled.`,
    reminder: `Your appointment with Dr. ${doctorName} starts in 15 minutes!`,
  };

  return await createNotificationForUser(
    userId,
    userType,
    type === "reminder" ? "Appointment Starting Soon" : "Appointment Update",
    messages[type],
    "appointment",
    {
      appointmentId,
      doctorName,
      scheduledAt: scheduledAt.toISOString(),
      status: type,
    }
  );
};

/**
 * 📦 Create order notification
 */
export const createOrderNotification = async (
  userId: string,
  userType: "User" | "Doctor",
  orderId: string,
  type: "placed" | "confirmed" | "shipped" | "delivered" | "cancelled",
  orderDetails?: string
) => {
  const messages = {
    placed: "Your order has been placed successfully!",
    confirmed: "Your order has been confirmed and is being processed.",
    shipped: "Your order has been shipped!",
    delivered: "Your order has been delivered. Enjoy!",
    cancelled: "Your order has been cancelled.",
  };

  return await createNotificationForUser(
    userId,
    userType,
    `Order ${type.charAt(0).toUpperCase() + type.slice(1)}`,
    orderDetails || messages[type],
    "order",
    { orderId }
  );
};