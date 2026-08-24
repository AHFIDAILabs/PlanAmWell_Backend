import { Request, Response } from "express";
import { Event } from "../models/Event";
import { EventRsvp } from "../models/EventRsvp";

export const getEvents = async (req: Request, res: Response): Promise<Response> => {
  try {
    const events = await Event.find({ isActive: true, startsAt: { $gte: new Date() } }).sort({ startsAt: 1 });
    return res.json({ success: true, data: events });
  } catch (err: any) {
    console.error("[Event] list error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to fetch events" });
  }
};

export const getEventById = async (req: Request, res: Response): Promise<Response> => {
  try {
    const event = await Event.findOne({ _id: req.params.id, isActive: true });
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    return res.json({ success: true, data: event });
  } catch (err: any) {
    console.error("[Event] get error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to fetch event" });
  }
};

export const createEvent = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { title, description, category, startsAt, endsAt, location, isVirtual, capacity } = req.body;

    if (!title || !description || !startsAt) {
      return res.status(400).json({ success: false, message: "title, description and startsAt are required" });
    }

    const event = await Event.create({
      title: title.trim(),
      description: description.trim(),
      category: category?.trim(),
      startsAt: new Date(startsAt),
      endsAt: endsAt ? new Date(endsAt) : undefined,
      location: location?.trim(),
      isVirtual: !!isVirtual,
      capacity: capacity || undefined,
      createdBy: req.auth?.id,
    });

    return res.status(201).json({ success: true, data: event });
  } catch (err: any) {
    console.error("[Event] create error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to create event" });
  }
};

export const updateEvent = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { id } = req.params;
    const { title, description, category, startsAt, endsAt, location, isVirtual, capacity, isActive } = req.body;

    const event = await Event.findById(id);
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });

    if (title !== undefined) event.title = title.trim();
    if (description !== undefined) event.description = description.trim();
    if (category !== undefined) event.category = category?.trim();
    if (startsAt !== undefined) event.startsAt = new Date(startsAt);
    if (endsAt !== undefined) event.endsAt = endsAt ? new Date(endsAt) : undefined;
    if (location !== undefined) event.location = location?.trim();
    if (isVirtual !== undefined) event.isVirtual = !!isVirtual;
    if (capacity !== undefined) event.capacity = capacity || undefined;
    if (isActive !== undefined) event.isActive = isActive;

    await event.save();
    return res.json({ success: true, data: event });
  } catch (err: any) {
    console.error("[Event] update error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to update event" });
  }
};

export const deleteEvent = async (req: Request, res: Response): Promise<Response> => {
  try {
    const deleted = await Event.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, message: "Event not found" });
    return res.json({ success: true, message: "Event deleted" });
  } catch (err: any) {
    console.error("[Event] delete error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to delete event" });
  }
};

export const rsvpToEvent = async (req: Request, res: Response): Promise<Response> => {
  try {
    const userId = req.auth?.id;
    const { id: eventId } = req.params;
    const { chosenName, reminderOptIn } = req.body;

    if (!chosenName || !chosenName.trim()) {
      return res.status(400).json({ success: false, message: "chosenName is required" });
    }

    const event = await Event.findOne({ _id: eventId, isActive: true });
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });

    if (event.capacity) {
      const goingCount = await EventRsvp.countDocuments({ eventId, status: "going" });
      const existing = await EventRsvp.findOne({ eventId, userId });
      if (goingCount >= event.capacity && (!existing || existing.status !== "going")) {
        return res.status(409).json({ success: false, message: "This event is full" });
      }
    }

    const rsvp = await EventRsvp.findOneAndUpdate(
      { eventId, userId },
      { chosenName: chosenName.trim(), reminderOptIn: !!reminderOptIn, status: "going" },
      { upsert: true, new: true }
    );

    return res.json({ success: true, data: rsvp });
  } catch (err: any) {
    console.error("[Event] rsvp error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to RSVP" });
  }
};

export const cancelRsvp = async (req: Request, res: Response): Promise<Response> => {
  try {
    const userId = req.auth?.id;
    const { id: eventId } = req.params;

    const rsvp = await EventRsvp.findOneAndUpdate({ eventId, userId }, { status: "cancelled" }, { new: true });
    if (!rsvp) return res.status(404).json({ success: false, message: "RSVP not found" });

    return res.json({ success: true, data: rsvp });
  } catch (err: any) {
    console.error("[Event] cancel rsvp error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to cancel RSVP" });
  }
};

export const getMyRsvps = async (req: Request, res: Response): Promise<Response> => {
  try {
    const userId = req.auth?.id;
    const rsvps = await EventRsvp.find({ userId, status: "going" }).sort({ createdAt: -1 });
    return res.json({ success: true, data: rsvps });
  } catch (err: any) {
    console.error("[Event] my rsvps error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to fetch your RSVPs" });
  }
};
