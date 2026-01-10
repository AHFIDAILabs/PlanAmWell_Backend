// controllers/notificationController.ts - UPGRADED
import { Request, Response } from "express";
import Notification, { INotification } from "../models/notifications";
import { Appointment } from "../models/appointment";
import { NotificationService } from "../services/NotificationService";

/**
 * 📥 Get user notifications
 */
export const getNotifications = async (req: Request, res: Response) => {
  try {
    const filter = (req.query.filter as string) || "all";
    const userId = req.auth!.id;

    // console.log("🔍 Fetching notifications for:", userId, "filter:", filter);

    const query: any = { userId };
    if (filter === "unread") query.isRead = false;

    const notifications: INotification[] = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(50);

    // console.log("✅ Found notifications:", notifications.length);

    res.json({ success: true, data: notifications });
  } catch (error: any) {
    console.error("❌ Error fetching notifications:", error);
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

    res.json({
      success: true,
      data: { count },
    });
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
    const { userId, userType, title, message, type, metadata } = req.body;

    if (!userId || !title || !message || !type) {
      return res.status(400).json({ 
        success: false, 
        message: "Missing required fields (userId, title, message, type)." 
      });
    }

    // ✅ Use NotificationService for consistency
    const notification = await NotificationService.create({
      userId: userId.toString(),
      userType: userType || "User",
      title,
      message,
      type,
      metadata,
    });

    res.status(201).json({ success: true, data: notification });
  } catch (error: any) {
    console.error("❌ Error in createNotification (Admin):", error);
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
export const getUpcomingAppointmentsSummary = async (
  req: Request,
  res: Response
) => {
  try {
    const userId = req.auth!.id;
    const now = new Date();

    const upcomingAppointments = await Appointment.find({
      userId,
      status: "confirmed",
      scheduledAt: { $gte: now },
    })
      .populate("doctorId", "firstName lastName profileImage specialization")
      .sort({ scheduledAt: 1 })
      .limit(3);

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