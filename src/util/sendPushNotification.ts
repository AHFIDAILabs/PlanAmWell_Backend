import { Document } from "mongoose";
import Expo from "expo-server-sdk";
import { User } from "../models/user";
import Notification, { INotification } from "../models/notifications";

// Create a new Expo SDK client
const expo = new Expo();

/**
 * 📲 Send push notification to a user
 */
export async function sendPushNotification(
  userId: string,
  notification: Document<unknown, {}, INotification> & INotification
) {
  try {
    const user = await User.findById(userId).select("expoPushTokens");
    if (!user || !user.expoPushTokens?.length) {
      console.log(`[PushNotification] No tokens found for user ${userId}`);
      return;
    }

    const messages = user.expoPushTokens
      .filter((token) => Expo.isExpoPushToken(token))
      .map((token) => ({
        to: token,
        sound: "default" as const,
        title: notification.title,
        body: notification.message,
        data: notification.metadata || {},
      }));

    if (!messages.length) {
      console.log(`[PushNotification] No valid Expo tokens for user ${userId}`);
      return;
    }

    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      try {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        console.log(`[PushNotification] Sent ${tickets.length} notifications to user ${userId}`);
      } catch (err) {
        console.error("[PushNotification] Error sending push notifications:", err);
      }
    }
  } catch (error) {
    console.error("[PushNotification] Failed:", error);
  }
}

/**
 * 🔔 Create appointment notification and send push
 */
export const createAppointmentNotification = async (
  userId: string,
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

  const notification = await Notification.create({
    userId,
    type: "appointment", // ✅ Fixed: matches schema enum
    title: type === "reminder" ? "Appointment Starting Soon" : "Appointment Update",
    message: messages[type],
    metadata: { 
      appointmentId, 
      time: scheduledAt.toISOString() // Store as ISO string
    },
    isRead: false,
  });

  // Send push notification
  await sendPushNotification(userId, notification);
  return notification;
};

/**
 * 📦 Create order notification and send push
 */
export const createOrderNotification = async (
  userId: string,
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

  const notification = await Notification.create({
    userId,
    type: "order",
    title: `Order ${type.charAt(0).toUpperCase() + type.slice(1)}`,
    message: orderDetails || messages[type],
    metadata: { orderId },
    isRead: false,
  });

  await sendPushNotification(userId, notification);
  return notification;
};