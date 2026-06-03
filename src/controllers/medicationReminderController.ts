import { Request, Response } from "express";
import { MedicationReminder } from "../models/MedicationReminder";

export const createReminder = async (req: Request, res: Response): Promise<Response> => {
  try {
    const userId = req.auth?.id;
    const userType = req.auth?.role === "Doctor" ? "Doctor" : "User";
    const { drugName, dosage, frequency, times, instructions, color, startDate, endDate } = req.body;

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
    return res.json({ success: true, data: reminders });
  } catch (err: any) {
    console.error("[MedicationReminder] get error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to fetch reminders" });
  }
};

export const updateReminder = async (req: Request, res: Response): Promise<Response> => {
  try {
    const userId = req.auth?.id;
    const { id } = req.params;
    const { drugName, dosage, frequency, times, instructions, color, startDate, endDate, isActive } = req.body;

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
