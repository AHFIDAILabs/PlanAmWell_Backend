import { Document } from "mongoose";
import Expo from "expo-server-sdk";
import { User } from "../models/user";
import Notification, { INotification } from "../models/notifications";

// Create a new Expo SDK client
const expo = new Expo();

// Send push notification to a user
export async function sendPushNotification(
  userId: string,
  notification: Document<unknown, {}, INotification> & INotification
) {
  try {
    const user = await User.findById(userId).select("expoPushTokens");
    if (!user || !user.expoPushTokens?.length) return;

    const messages = user.expoPushTokens
      .filter((token) => Expo.isExpoPushToken(token))
      .map((token) => ({
        to: token,
        sound: "default",
        title: notification.title,
        body: notification.message,
        data: notification.metadata || {},
      }));

    if (!messages.length) return;

    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      try {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        console.log(`[PushNotification] Sent ${tickets.length} notifications`);
      } catch (err) {
        console.error("[PushNotification] Error sending push notifications:", err);
      }
    }
  } catch (error) {
    console.error("[PushNotification] Failed:", error);
  }
}

// Create appointment notification
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
    type: "appointment_update",
    title: type === "reminder" ? "Appointment Starting Soon" : "Appointment Update",
    message: messages[type],
    metadata: { appointmentId, status: type, doctorName, scheduledAt },
    isRead: false,
  });

  await sendPushNotification(userId, notification);
  return notification;
};
