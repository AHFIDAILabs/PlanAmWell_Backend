// routes/notificationRoutes.ts - FIXED VERSION
import express from "express";
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getUpcomingAppointmentsSummary,
  createNotification,
} from "../controllers/notification";
import { verifyToken, authorize } from "../middleware/auth";

const notificationRouter = express.Router();

// ✅ ALL notification routes require authentication
// Apply verifyToken to all routes in this router
notificationRouter.use(verifyToken);

// 📥 Read notifications
notificationRouter.get("/", getNotifications);

// 🔢 Get unread count
notificationRouter.get("/unread-count", getUnreadCount);

// 📊 Get appointments summary
notificationRouter.get("/appointments-summary", getUpcomingAppointmentsSummary);

// ✅ Mark as read
notificationRouter.put("/:notificationId/read", markAsRead);
notificationRouter.put("/read-all", markAllAsRead);

// ➕ Create notification (Admin only)
notificationRouter.post("/", authorize("Admin"), createNotification);

// 🗑️ Delete notification
notificationRouter.delete("/:notificationId", deleteNotification);

export default notificationRouter;