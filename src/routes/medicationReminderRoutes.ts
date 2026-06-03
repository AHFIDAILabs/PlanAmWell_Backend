import { Router } from "express";
import { verifyToken } from "../middleware/auth";
import {
  createReminder,
  getReminders,
  updateReminder,
  deleteReminder,
  toggleReminder,
} from "../controllers/medicationReminderController";

const medicationReminderRouter = Router();

medicationReminderRouter.use(verifyToken);

medicationReminderRouter.get("/", getReminders);
medicationReminderRouter.post("/", createReminder);
medicationReminderRouter.put("/:id", updateReminder);
medicationReminderRouter.patch("/:id/toggle", toggleReminder);
medicationReminderRouter.delete("/:id", deleteReminder);

export default medicationReminderRouter;
