import { Request, Response } from "express";
import { MedicationReminder } from "../models/MedicationReminder";
import { DoseLog } from "../models/DoseLog";

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

export const createReminder = async (req: Request, res: Response): Promise<Response> => {
  try {
    const userId = req.auth?.id;
    const userType = req.auth?.role === "Doctor" ? "Doctor" : "User";
    const { drugName, dosage, frequency, times, instructions, color, startDate, endDate, displayAlias } = req.body;

    if (!drugName || !times || !Array.isArray(times) || times.length === 0) {
      return res.status(400).json({ success: false, message: "drugName and times are required" });
    }

    const reminder = await MedicationReminder.create({
      userId,
      userType,
      drugName: drugName.trim(),
      dosage: dosage?.trim() || "",
      frequency: frequency || "once_daily",
      times,
      instructions: instructions?.trim(),
      color: color || "#00897B",
      startDate: startDate ? new Date(startDate) : new Date(),
      endDate: endDate ? new Date(endDate) : undefined,
      displayAlias: displayAlias?.trim() || undefined,
    });

    return res.status(201).json({ success: true, data: reminder });
  } catch (err: any) {
    console.error("[MedicationReminder] create error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to create reminder" });
  }
};

export const getReminders = async (req: Request, res: Response): Promise<Response> => {
  try {
    const userId = req.auth?.id;
    const reminders = await MedicationReminder.find({ userId }).sort({ createdAt: -1 });

    const todaysLogs = await DoseLog.find({ userId, date: todayString() });
    const takenReminderIds = new Set(todaysLogs.map((log) => log.reminderId.toString()));

    const data = reminders.map((reminder) => ({
      ...reminder.toObject(),
      takenToday: takenReminderIds.has((reminder._id as any).toString()),
    }));

    return res.json({ success: true, data });
  } catch (err: any) {
    console.error("[MedicationReminder] get error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to fetch reminders" });
  }
};

export const updateReminder = async (req: Request, res: Response): Promise<Response> => {
  try {
    const userId = req.auth?.id;
    const { id } = req.params;
    const { drugName, dosage, frequency, times, instructions, color, startDate, endDate, isActive, displayAlias } =
      req.body;

    const reminder = await MedicationReminder.findOne({ _id: id, userId });
    if (!reminder) return res.status(404).json({ success: false, message: "Reminder not found" });

    if (drugName !== undefined) reminder.drugName = drugName.trim();
    if (dosage !== undefined) reminder.dosage = dosage.trim();
    if (frequency !== undefined) reminder.frequency = frequency;
    if (times !== undefined && Array.isArray(times)) reminder.times = times;
    if (instructions !== undefined) reminder.instructions = instructions.trim();
    if (color !== undefined) reminder.color = color;
    if (isActive !== undefined) reminder.isActive = isActive;
    if (startDate !== undefined) reminder.startDate = new Date(startDate);
    if (endDate !== undefined) reminder.endDate = endDate ? new Date(endDate) : undefined;
    if (displayAlias !== undefined) reminder.displayAlias = displayAlias?.trim() || undefined;

    await reminder.save();
    return res.json({ success: true, data: reminder });
  } catch (err: any) {
    console.error("[MedicationReminder] update error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to update reminder" });
  }
};

export const deleteReminder = async (req: Request, res: Response): Promise<Response> => {
  try {
    const userId = req.auth?.id;
    const { id } = req.params;

    const deleted = await MedicationReminder.findOneAndDelete({ _id: id, userId });
    if (!deleted) return res.status(404).json({ success: false, message: "Reminder not found" });

    return res.json({ success: true, message: "Reminder deleted" });
  } catch (err: any) {
    console.error("[MedicationReminder] delete error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to delete reminder" });
  }
};

export const toggleReminder = async (req: Request, res: Response): Promise<Response> => {
  try {
    const userId = req.auth?.id;
    const { id } = req.params;

    const reminder = await MedicationReminder.findOne({ _id: id, userId });
    if (!reminder) return res.status(404).json({ success: false, message: "Reminder not found" });

    reminder.isActive = !reminder.isActive;
    await reminder.save();
    return res.json({ success: true, data: reminder });
  } catch (err: any) {
    console.error("[MedicationReminder] toggle error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to toggle reminder" });
  }
};

// Marks today's dose taken — idempotent (checking an already-checked box is
// a no-op, not an error), via an upsert on the (reminderId, date) unique index.
export const markDoseTaken = async (req: Request, res: Response): Promise<Response> => {
  try {
    const userId = req.auth?.id;
    const { id } = req.params;

    const reminder = await MedicationReminder.findOne({ _id: id, userId });
    if (!reminder) return res.status(404).json({ success: false, message: "Reminder not found" });

    await DoseLog.findOneAndUpdate(
      { reminderId: id, date: todayString() },
      { $setOnInsert: { reminderId: id, userId, date: todayString(), takenAt: new Date() } },
      { upsert: true }
    );

    return res.json({ success: true, data: { takenToday: true } });
  } catch (err: any) {
    console.error("[MedicationReminder] mark-taken error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to mark dose taken" });
  }
};

export const unmarkDoseTaken = async (req: Request, res: Response): Promise<Response> => {
  try {
    const userId = req.auth?.id;
    const { id } = req.params;

    const reminder = await MedicationReminder.findOne({ _id: id, userId });
    if (!reminder) return res.status(404).json({ success: false, message: "Reminder not found" });

    await DoseLog.deleteOne({ reminderId: id, userId, date: todayString() });

    return res.json({ success: true, data: { takenToday: false } });
  } catch (err: any) {
    console.error("[MedicationReminder] unmark-taken error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to unmark dose taken" });
  }
};
