import { Request, Response } from "express";
import Notification, { INotification } from "../models/notifications";
import { Appointment } from "../models/appointment";
import { Document } from "mongoose";
import { sendPushNotification } from "../util/sendPushNotification"; 

/**
 * 🔔 Helper: Create notification for appointment status changes
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
    type: "appointment_update",
    title: type === "reminder" ? "Appointment Starting Soon" : "Appointment Update",
    message: messages[type],
    metadata: {
      appointmentId,
      status: type,
      doctorName,
      scheduledAt,
    },
    isRead: false,
  });

  // ✅ Send push notification via Expo
  await sendPushNotification(userId, notification as Document<unknown, {}, INotification> & INotification);

  return notification;
};

/**
 * 📥 Get user notifications
 */
export const getNotifications = async (req: Request, res: Response) => {
  try {
    const filter = (req.query.filter as string) || "all";
    const userId = req.auth!.id;

    const query: any = { userId };
    if (filter === "unread") query.isRead = false;

    const notifications: INotification[] = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({ success: true, data: notifications });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 🔢 Get unread notification count
 */
export const getUnreadCount = async (req: Request, res: Response) => {
  try {
    const userId = req.auth!.id;
    const count = await Notification.countDocuments({ userId, isRead: false });
    res.json({ success: true, count });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * ✅ Mark notification as read
 */
export const markAsRead = async (req: Request, res: Response) => {
  try {
    const { notificationId } = req.params;
    await Notification.findByIdAndUpdate(notificationId, { isRead: true });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * ✅ Mark all notifications as read
 */
export const markAllAsRead = async (req: Request, res: Response) => {
  try {
    const userId = req.auth!.id;
    await Notification.updateMany({ userId, isRead: false }, { isRead: true });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * ➕ Create notification (admin/system use)
 */
export const createNotification = async (req: Request, res: Response) => {
  try {
    const notification = await Notification.create(req.body);
    // Optional: send push notification automatically if userId is provided
    if (notification.userId) {
      const userIdStr = notification.userId.toString();
      await sendPushNotification(userIdStr, notification as Document<unknown, {}, INotification> & INotification);
    }
    res.status(201).json({ success: true, data: notification });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 🗑️ Delete notification
 */
export const deleteNotification = async (req: Request, res: Response) => {
  try {
    const { notificationId } = req.params;
    await Notification.findByIdAndDelete(notificationId);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 📊 Get upcoming appointments summary for profile screen
 */
export const getUpcomingAppointmentsSummary = async (req: Request, res: Response) => {
  try {
    const userId = req.auth!.id;
    const now = new Date();

    // Get next 3 upcoming confirmed appointments
    const upcomingAppointments = await Appointment.find({
      userId,
      status: "confirmed",
      scheduledAt: { $gte: now },
    })
      .populate("doctorId", "firstName lastName profileImage specialization")
      .sort({ scheduledAt: 1 })
      .limit(3);

    // Count pending appointments
    const pendingCount = await Appointment.countDocuments({
      userId,
      status: "pending",
    });

    res.json({
      success: true,
      data: {
        upcoming: upcomingAppointments,
        pendingCount,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
