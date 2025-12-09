// routes/notificationRoutes.ts
import express from "express";
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getUpcomingAppointmentsSummary,
} from "../controllers/notification";
import { guestAuth, verifyToken } from "../middleware/auth"; 

const notificationRouter = express.Router();

// 🔒 All routes protected
notificationRouter.use(guestAuth, verifyToken);

// Read
notificationRouter.get("/", getNotifications);
notificationRouter.get("/unread-count", getUnreadCount);
notificationRouter.get("/appointments-summary", getUpcomingAppointmentsSummary);

// Update
notificationRouter.put("/:notificationId/read", markAsRead);
notificationRouter.put("/read-all", markAllAsRead);

// Delete
notificationRouter.delete("/:notificationId", deleteNotification);

// ❌ REMOVE public create endpoint
export default notificationRouter;
