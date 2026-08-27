import { Request, Response } from "express";
import { Event, EVENT_BANNER_PRESETS, EventBannerPreset } from "../models/Event";
import { EventRsvp } from "../models/EventRsvp";
import { uploadToCloudinary, deleteFromCloudinary } from "../middleware/claudinary";

function isValidPreset(value: unknown): value is EventBannerPreset {
  return typeof value === "string" && (EVENT_BANNER_PRESETS as readonly string[]).includes(value);
}

// rsvpCount is an aggregate number only — never attendee names or any other
// identifying detail. Showing "12 going" gives a lightweight sense that
// other people are here too without exposing who anyone is, which matters
// on a platform whose whole premise is confidential, non-judgmental care.
async function withRsvpCounts<T extends { _id: any }>(events: T[]): Promise<(T & { rsvpCount: number })[]> {
  if (events.length === 0) return [];
  const counts = await EventRsvp.aggregate([
    { $match: { eventId: { $in: events.map((e) => e._id) }, status: "going" } },
    { $group: { _id: "$eventId", count: { $sum: 1 } } },
  ]);
  const countByEvent = new Map(counts.map((c) => [String(c._id), c.count]));
  return events.map((e) => ({ ...e, rsvpCount: countByEvent.get(String(e._id)) ?? 0 }));
}

export const getEvents = async (req: Request, res: Response): Promise<Response> => {
  try {
    const events = await Event.find({ isActive: true, startsAt: { $gte: new Date() } })
      .sort({ startsAt: 1 })
      .lean();
    return res.json({ success: true, data: await withRsvpCounts(events) });
  } catch (err: any) {
    console.error("[Event] list error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to fetch events" });
  }
};

// Admin management view — the public getEvents above only ever shows
// active, not-yet-started events (that's the right behavior for patients
// browsing), which means an admin using that same endpoint could never see
// past events, drafts they've deactivated, or manage anything after it
// starts. Also surfaces the "going" count per event so an admin can see
// interest at a glance without opening each one.
export const getAllEventsAdmin = async (req: Request, res: Response): Promise<Response> => {
  try {
    const events = await Event.find({}).sort({ startsAt: -1 }).lean();
    return res.json({ success: true, data: await withRsvpCounts(events) });
  } catch (err: any) {
    console.error("[Event] admin list error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to fetch events" });
  }
};

export const getEventById = async (req: Request, res: Response): Promise<Response> => {
  try {
    const event = await Event.findOne({ _id: req.params.id, isActive: true }).lean();
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });

    // The detail page previously had no way to know the viewer had already
    // RSVP'd beyond the current session's own local state — reloading the
    // page, or coming back another day, reverted the button to "RSVP to
    // this event" even though they were already going. Returning the
    // viewer's own RSVP here (never anyone else's) fixes that at the source.
    const userId = req.auth?.id;
    const myRsvp = userId ? await EventRsvp.findOne({ eventId: event._id, userId, status: "going" }).lean() : null;

    const [withCount] = await withRsvpCounts([event]);
    return res.json({ success: true, data: { ...withCount, myRsvp } });
  } catch (err: any) {
    console.error("[Event] get error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to fetch event" });
  }
};

export const createEvent = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { title, description, category, startsAt, endsAt, location, isVirtual, capacity, bannerPreset } = req.body;

    if (!title || !description || !startsAt) {
      return res.status(400).json({ success: false, message: "title, description and startsAt are required" });
    }

    let bannerImage: { url: string; publicId: string } | undefined;
    if (req.file?.buffer) {
      try {
        const { secure_url, public_id } = await uploadToCloudinary(req.file.buffer, "events");
        bannerImage = { url: secure_url, publicId: public_id };
      } catch (error) {
        console.error("[Event] banner upload error:", error);
        return res.status(500).json({ success: false, message: "Failed to upload banner image" });
      }
    }

    const event = await Event.create({
      title: title.trim(),
      description: description.trim(),
      category: category?.trim(),
      startsAt: new Date(startsAt),
      endsAt: endsAt ? new Date(endsAt) : undefined,
      location: location?.trim(),
      isVirtual: isVirtual === true || isVirtual === "true",
      capacity: capacity || undefined,
      createdBy: req.auth?.id,
      // An uploaded photo wins over a preset pick if a caller somehow sends
      // both — bannerImage is only ever set here when a file actually came
      // through multer.
      bannerImage,
      bannerPreset: !bannerImage && isValidPreset(bannerPreset) ? bannerPreset : undefined,
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
    const {
      title,
      description,
      category,
      startsAt,
      endsAt,
      location,
      isVirtual,
      capacity,
      isActive,
      bannerPreset,
      clearBanner,
    } = req.body;

    const event = await Event.findById(id);
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });

    if (req.file?.buffer) {
      try {
        const { secure_url, public_id } = await uploadToCloudinary(req.file.buffer, "events");
        // Clean up the previous upload so switching banners doesn't leave
        // orphaned files behind in Cloudinary.
        if (event.bannerImage?.publicId) {
          deleteFromCloudinary(event.bannerImage.publicId).catch((err) =>
            console.error("[Event] old banner cleanup failed (non-fatal):", err)
          );
        }
        event.bannerImage = { url: secure_url, publicId: public_id };
        event.bannerPreset = undefined;
      } catch (error) {
        console.error("[Event] banner upload error:", error);
        return res.status(500).json({ success: false, message: "Failed to upload banner image" });
      }
    } else if (isValidPreset(bannerPreset)) {
      if (event.bannerImage?.publicId) {
        deleteFromCloudinary(event.bannerImage.publicId).catch((err) =>
          console.error("[Event] old banner cleanup failed (non-fatal):", err)
        );
      }
      event.bannerPreset = bannerPreset;
      event.bannerImage = undefined;
    } else if (clearBanner === true || clearBanner === "true") {
      if (event.bannerImage?.publicId) {
        deleteFromCloudinary(event.bannerImage.publicId).catch((err) =>
          console.error("[Event] old banner cleanup failed (non-fatal):", err)
        );
      }
      event.bannerImage = undefined;
      event.bannerPreset = undefined;
    }

    if (title !== undefined) event.title = title.trim();
    if (description !== undefined) event.description = description.trim();
    if (category !== undefined) event.category = category?.trim();
    if (startsAt !== undefined) event.startsAt = new Date(startsAt);
    if (endsAt !== undefined) event.endsAt = endsAt ? new Date(endsAt) : undefined;
    if (location !== undefined) event.location = location?.trim();
    // Multipart form submissions (whenever a banner file is attached) send
    // every field as a string, including "false" — !!"false" is true, so a
    // naive truthy check here would make "make it not virtual" silently
    // no-op the moment an image upload was also involved in the same save.
    if (isVirtual !== undefined) event.isVirtual = isVirtual === true || isVirtual === "true";
    if (capacity !== undefined) event.capacity = capacity ? Number(capacity) : undefined;
    if (isActive !== undefined) event.isActive = isActive === true || isActive === "true";

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
    // Populated so the "My Events" list can render title/time directly
    // instead of the client re-fetching every event by id one at a time.
    const rsvps = await EventRsvp.find({ userId, status: "going" })
      .sort({ createdAt: -1 })
      .populate("eventId");
    return res.json({ success: true, data: rsvps });
  } catch (err: any) {
    console.error("[Event] my rsvps error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to fetch your RSVPs" });
  }
};
