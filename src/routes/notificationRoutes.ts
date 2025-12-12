// routes/notificationRoutes.ts
import express from "express";
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getUpcomingAppointmentsSummary,
  createNotification, // <-- ADDED import for Admin creation
} from "../controllers/notification";
import { guestAuth, verifyToken, authorize } from "../middleware/auth"; // <-- ADDED authorize

const notificationRouter = express.Router();

// 🔒 Routes protected by default (User/Doctor)
notificationRouter.use(guestAuth, verifyToken);

// Read
notificationRouter.get("/", getNotifications);
notificationRouter.get("/unread-count", getUnreadCount);
notificationRouter.get("/appointments-summary", getUpcomingAppointmentsSummary);

// Update
notificationRouter.put("/:notificationId/read", markAsRead);
notificationRouter.put("/read-all", markAllAsRead);

// Create (Admin/System Use)
// 🔒 Only Admin can create notifications manually
notificationRouter.post("/", authorize("Admin"), createNotification); // <-- ADDED Admin route

// Delete
notificationRouter.delete("/:notificationId", deleteNotification);

export default notificationRouter;