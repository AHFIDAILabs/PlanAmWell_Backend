import { Router } from "express";
import { verifyToken } from "../middleware/auth";
import {
  createReminder,
  getReminders,
  updateReminder,
  deleteReminder,
  toggleReminder,
  markDoseTaken,
  unmarkDoseTaken,
} from "../controllers/medicationReminderController";

const medicationReminderRouter = Router();

medicationReminderRouter.use(verifyToken);

medicationReminderRouter.get("/", getReminders);
medicationReminderRouter.post("/", createReminder);
medicationReminderRouter.put("/:id", updateReminder);
medicationReminderRouter.patch("/:id/toggle", toggleReminder);
medicationReminderRouter.post("/:id/mark-taken", markDoseTaken);
medicationReminderRouter.post("/:id/unmark-taken", unmarkDoseTaken);
medicationReminderRouter.delete("/:id", deleteReminder);

export default medicationReminderRouter;
