import { Document } from "mongoose";
import Expo from "expo-server-sdk";
import { User } from "../models/user";
import { Doctor } from "../models/doctor";
import Notification, { INotification } from "../models/notifications";

// Create a new Expo SDK client
const expo = new Expo();

/**
 * 📲 Send push notification to ANY user (User or Doctor)
 * @param userId - ID of the User or Doctor to notify
 * @param notification - The Mongoose notification document
 */
export async function sendPushNotification(
  userId: string,
  // Use a Mongoose Document type with the INotification interface
  notification: Document<unknown, {}, INotification> & INotification
) {
  try {
    // Try to find user in User model first
    let user = await User.findById(userId).select("expoPushTokens");

    // If not found, try Doctor model
    if (!user) {
      // Use the Doctor model's type definition for better safety than 'as any'
      user = await Doctor.findById(userId).select("expoPushTokens") as typeof Doctor.prototype | null;
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
 * 🔔 NEW: Create notification for ANY user (User or Doctor)
 */
export const createNotificationForUser = async (
  userId: string,
  title: string,
  message: string,
  type: "appointment" | "order" | "article" | "supplement" | "system",
  metadata?: any
) => {
  try {
    const notification = await Notification.create({
      userId,
      type,
      title,
      message,
      metadata,
      isRead: false,
    });

    // Send push notification
    try {
      await sendPushNotification(
        userId,
        // The return type of .create() is complex, but the function handles the Document type
        notification as Document<unknown, {}, INotification> & INotification
      );
    } catch (err) {
      console.error("Failed to send push notification:", err);
    }

    console.log(`✅ Notification created and sent to ${userId}`);
    return notification;
  } catch (error) {
    console.error(`❌ Failed to create notification for ${userId}:`, error);
    throw error;
  }
};

/**
 * 🔔 LEGACY: Create appointment notification for patients (backward compatibility)
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
    type: "appointment",
    title:
      type === "reminder" ? "Appointment Starting Soon" : "Appointment Update",
    message: messages[type],
    metadata: {
      appointmentId,
      doctorName,
      scheduledAt: scheduledAt.toISOString(),
      status: type, // Added 'status' for consistency
    },
    isRead: false,
  });

  // Send push notification
  try {
    await sendPushNotification(
      userId,
      notification as Document<unknown, {}, INotification> & INotification
    );
  } catch (err) {
    console.error("Failed to send push notification:", err);
  }

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

  await sendPushNotification(
    userId,
    notification as Document<unknown, {}, INotification> & INotification
  );
  return notification;
};