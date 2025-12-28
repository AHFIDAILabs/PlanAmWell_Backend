import Expo from "expo-server-sdk";
import { User } from "../models/user";
import { Doctor } from "../models/doctor";
import Notification, { NotificationDocument } from "../models/notifications";
import { emitNotification } from "../index";

const expo = new Expo();

/**
 * 📲 Send push notification to ANY user (User or Doctor)
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
      console.log(`[PushNotification] No tokens found for user ${userId}`);
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
      console.log(`[PushNotification] No valid Expo tokens for user ${userId}`);
      return;
    }

    for (const chunk of expo.chunkPushNotifications(messages)) {
      try {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        console.log(
          `[PushNotification] ✅ Sent ${tickets.length} notifications to user ${userId}`
        );
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

    console.log(`💾 Notification created in DB for ${userType} ${userId}:`, {
      _id: notification._id,
      title: notification.title,
      type: notification.type,
    });

    // ✅ Convert to plain object for Socket.IO emission
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

    // ✅ CRITICAL FIX: Emit to correct user (convert to string to match socket room format)
    const targetUserId = userId.toString();
    console.log(`📡 Emitting notification to user: ${targetUserId}`);
    const emitted = emitNotification(targetUserId, notificationObject);
    
    if (emitted) {
      console.log(`✅ Real-time notification sent to ${userType} ${targetUserId}`);
    } else {
      console.log(`⚠️ ${userType} ${targetUserId} not connected - notification saved in DB`);
    }

    // ✅ Send push notification (non-blocking)
    sendPushNotification(targetUserId, notification).catch(console.error);

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

  console.log(`📅 Creating appointment notification for ${userType} ${userId}:`, {
    type,
    appointmentId,
    doctorName,
  });

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