import { Router } from "express";
import {
  getNotifications,
  createNotification,
  markAsRead,
  markAllAsRead,
  deleteNotification,
} from "../controllers/notification";
import { guestAuth, verifyToken, hydrateUser } from "../middleware/auth";

const notificationRouter = Router();

notificationRouter.use(guestAuth, verifyToken, hydrateUser);

notificationRouter.get("/", getNotifications);
notificationRouter.post("/", createNotification);
notificationRouter.patch("/:notificationId/read", markAsRead);
notificationRouter.patch("/read-all", markAllAsRead);
notificationRouter.delete("/:notificationId", deleteNotification);

export default notificationRouter;
