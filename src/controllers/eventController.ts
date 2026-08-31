import { Request, Response } from "express";
import crypto from "crypto";
import { Event, EVENT_BANNER_PRESETS, EventBannerPreset } from "../models/Event";
import { EventRsvp } from "../models/EventRsvp";
import { uploadToCloudinary, deleteFromCloudinary } from "../middleware/claudinary";
import { resolveRedirectUrl } from "./checkoutController";
import { User } from "../models/user";

function isValidPreset(value: unknown): value is EventBannerPreset {
  return typeof value === "string" && (EVENT_BANNER_PRESETS as readonly string[]).includes(value);
}

// Independent of ORDER_PAYMENT_ENABLED — event ticketing and pharmacy orders
// are separate revenue streams that may go live at different times. Off
// (simulated) by default, same convention as every other payment toggle in
// this app. The real path reuses services/paymentProviders (built for
// consultation payments, never implemented) rather than a third separate
// real-payment integration — see initiateEventTicketPayment below.
function eventPaymentEnabled(): boolean {
  return process.env.EVENT_PAYMENT_ENABLED === "true";
}

const BACKEND_URL = process.env.BACKEND_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "";

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
    // ?all=true (landing page's "every event ever created" showcase) still
    // respects isActive — an admin-deactivated event stays unlisted — it
    // just drops the upcoming-only date filter so past events are included.
    const includePast = req.query.all === "true";
    const query = includePast ? { isActive: true } : { isActive: true, startsAt: { $gte: new Date() } };
    const events = await Event.find(query)
      .sort({ startsAt: includePast ? -1 : 1 })
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
    // Includes pending_payment (a ticketed event started but not yet paid
    // for) so the page can offer "complete payment" instead of a fresh RSVP.
    const userId = req.auth?.id;
    const myRsvp = userId
      ? await EventRsvp.findOne({ eventId: event._id, userId, status: { $in: ["going", "pending_payment"] } }).lean()
      : null;

    const [withCount] = await withRsvpCounts([event]);
    return res.json({ success: true, data: { ...withCount, myRsvp } });
  } catch (err: any) {
    console.error("[Event] get error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to fetch event" });
  }
};

export const createEvent = async (req: Request, res: Response): Promise<Response> => {
  try {
    const {
      title,
      description,
      category,
      startsAt,
      endsAt,
      location,
      isVirtual,
      capacity,
      bannerPreset,
      organizerName,
      registrationUrl,
      isPaidPlacement,
      ticketPriceKobo,
    } = req.body;

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
      organizerName: organizerName?.trim() || undefined,
      registrationUrl: registrationUrl?.trim() || undefined,
      isPaidPlacement: isPaidPlacement === true || isPaidPlacement === "true",
      ticketPriceKobo: ticketPriceKobo ? Number(ticketPriceKobo) : undefined,
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
      organizerName,
      registrationUrl,
      isPaidPlacement,
      ticketPriceKobo,
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
    if (organizerName !== undefined) event.organizerName = organizerName?.trim() || undefined;
    if (registrationUrl !== undefined) event.registrationUrl = registrationUrl?.trim() || undefined;
    if (isPaidPlacement !== undefined) event.isPaidPlacement = isPaidPlacement === true || isPaidPlacement === "true";
    if (ticketPriceKobo !== undefined) event.ticketPriceKobo = ticketPriceKobo ? Number(ticketPriceKobo) : undefined;

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

    // A ticketed event confirms the RSVP only once payment completes — see
    // initiateEventTicketPayment. Nothing below changes for a free event.
    if (event.ticketPriceKobo) {
      const rsvp = await EventRsvp.findOneAndUpdate(
        { eventId, userId },
        { chosenName: chosenName.trim(), reminderOptIn: !!reminderOptIn, status: "pending_payment" },
        { upsert: true, new: true }
      );
      return res.json({ success: true, data: rsvp, requiresPayment: true });
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

// ─────────────────────────────────────────────────────────────────────────────
// TICKETED EVENT PAYMENT
// Same simulate-by-default shape as paymentController's order flow (see that
// file's comments for the full reasoning) — kept as a separate, parallel
// implementation rather than generalizing the Order-scoped Payment model,
// deliberately: the order payment flow just went through a real production
// incident from an overly-clever idempotency shortcut, and event tickets are
// a small enough surface that some duplication is worth not touching that
// working code again.
// POST /api/v1/events/:id/rsvp/pay
// ─────────────────────────────────────────────────────────────────────────────
export const initiateEventTicketPayment = async (req: Request, res: Response): Promise<Response> => {
  try {
    const userId = req.auth?.id;
    const { id: eventId } = req.params;

    const event = await Event.findOne({ _id: eventId, isActive: true });
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    if (!event.ticketPriceKobo) {
      return res.status(422).json({ success: false, message: "This event does not require payment" });
    }

    const rsvp = await EventRsvp.findOne({ eventId, userId });
    if (!rsvp || rsvp.status !== "pending_payment") {
      return res.status(422).json({ success: false, message: "RSVP first before paying" });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (!user.email) {
      return res.status(422).json({ success: false, message: "Please add an email to your profile before paying for a ticket." });
    }

    // Same reuse-if-fresh-and-same-mode logic as paymentController.initiatePayment.
    const RESUMABLE_WINDOW_MS = 30 * 60 * 1000;
    const currentProvider: "simulation" | "partner" = eventPaymentEnabled() ? "partner" : "simulation";
    if (
      rsvp.checkoutUrl &&
      rsvp.provider === currentProvider &&
      rsvp.updatedAt &&
      Date.now() - rsvp.updatedAt.getTime() < RESUMABLE_WINDOW_MS
    ) {
      return res.json({
        success: true,
        message: "Payment already initiated",
        data: { checkoutUrl: rsvp.checkoutUrl, paymentReference: rsvp.paymentReference },
      });
    }

    const resolvedRedirectUrl = resolveRedirectUrl(String(event._id), req.body.redirectUrl);
    const reference = `EVT-${event.referralCode}-${crypto.randomBytes(4).toString("hex")}`;

    if (!eventPaymentEnabled()) {
      const checkoutUrl = `${BACKEND_URL}/api/v1/events/rsvp-payment/simulate/${reference}`;
      rsvp.paymentReference = reference;
      rsvp.transactionId = reference;
      rsvp.checkoutUrl = checkoutUrl;
      rsvp.amountKobo = event.ticketPriceKobo;
      rsvp.provider = "simulation";
      rsvp.redirectUrl = resolvedRedirectUrl;
      await rsvp.save();

      return res.status(201).json({
        success: true,
        message: "Payment initiated (simulation)",
        data: { checkoutUrl, paymentReference: reference },
      });
    }

    // Real path — deliberately unimplemented until a provider is actually
    // configured (see services/paymentProviders). Reusing that same
    // abstraction rather than standing up a third bespoke real-payment
    // integration alongside orders' Partner API and appointments' own
    // (also still unimplemented) provider.
    try {
      const { getPaymentProvider } = await import("../services/paymentProviders");
      const provider = getPaymentProvider();
      const result = await provider.initialize({
        amountKobo: event.ticketPriceKobo,
        email: user.email,
        reference,
        callbackUrl: resolvedRedirectUrl,
      });
      rsvp.paymentReference = reference;
      rsvp.checkoutUrl = result.authorizationUrl;
      rsvp.amountKobo = event.ticketPriceKobo;
      rsvp.provider = "partner";
      rsvp.redirectUrl = resolvedRedirectUrl;
      await rsvp.save();

      return res.status(201).json({
        success: true,
        data: { checkoutUrl: result.authorizationUrl, paymentReference: reference },
      });
    } catch (err: any) {
      console.error("[Event] real payment init failed:", err.message);
      return res.status(502).json({ success: false, message: "Payment provider is not available right now." });
    }
  } catch (err: any) {
    console.error("[Event] initiate ticket payment error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to start payment" });
  }
};

async function confirmEventTicketPaid(rsvp: InstanceType<typeof EventRsvp>): Promise<void> {
  if (rsvp.status === "going") return; // idempotent
  rsvp.status = "going";
  await rsvp.save();
}

// GET /api/v1/events/rsvp-payment/simulate/:reference
export const renderSimulatedEventCheckout = async (req: Request, res: Response): Promise<void> => {
  const { reference } = req.params;
  const rsvp = await EventRsvp.findOne({ paymentReference: reference, provider: "simulation" }).populate("eventId");
  if (!rsvp) {
    res.status(404).send("<h2>Simulated payment not found</h2>");
    return;
  }

  if (rsvp.status !== "pending_payment") {
    const eventId = (rsvp.eventId as any)._id;
    res.send(renderEventSimulationResult(rsvp.status === "going", eventRedirectUrl(eventId, rsvp.redirectUrl)));
    return;
  }

  const amountNaira = ((rsvp.amountKobo ?? 0) / 100).toLocaleString();
  const eventTitle = (rsvp.eventId as any)?.title ?? "this event";
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Simulated Ticket Checkout</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: sans-serif; text-align: center; padding: 40px 20px; background: #f9f9f9; }
          .badge { display: inline-block; background: #FEF3C7; color: #92400E; font-size: 12px; font-weight: 700;
                   padding: 6px 14px; border-radius: 999px; margin-bottom: 20px; }
          h2 { color: #222; margin: 0 0 6px; }
          .amount { font-size: 32px; font-weight: 800; color: #D81E5B; margin: 16px 0 28px; }
          button { display: block; width: 100%; max-width: 320px; margin: 0 auto 14px; padding: 16px;
                    border-radius: 12px; border: none; font-size: 16px; font-weight: 700; cursor: pointer; }
          .success { background: #D81E5B; color: #fff; }
          .fail { background: #fff; color: #666; border: 1.5px solid #ddd; }
        </style>
      </head>
      <body>
        <span class="badge">SIMULATION — no real payment</span>
        <h2>Get your ticket for ${eventTitle}</h2>
        <p class="amount">₦${amountNaira}</p>
        <form method="POST" action="/api/v1/events/rsvp-payment/simulate/${reference}/complete">
          <button class="success" name="outcome" value="success" type="submit">Simulate Successful Payment</button>
          <button class="fail" name="outcome" value="failed" type="submit">Simulate Failed Payment</button>
        </form>
      </body>
    </html>
  `);
};

// POST /api/v1/events/rsvp-payment/simulate/:reference/complete
export const completeSimulatedEventPayment = async (req: Request, res: Response): Promise<void> => {
  const { reference } = req.params;
  const outcome = req.body?.outcome === "failed" ? "failed" : "success";

  const rsvp = await EventRsvp.findOne({ paymentReference: reference, provider: "simulation" }).populate("eventId");
  if (!rsvp) {
    res.status(404).send("<h2>Simulated payment not found</h2>");
    return;
  }

  const eventId = (rsvp.eventId as any)?._id ?? rsvp.eventId;

  if (rsvp.status === "pending_payment") {
    if (outcome === "success") {
      await confirmEventTicketPaid(rsvp);
    } else {
      rsvp.status = "cancelled";
      await rsvp.save();
    }
  }

  res.send(renderEventSimulationResult(rsvp.status === "going", eventRedirectUrl(eventId, rsvp.redirectUrl)));
};

// Mirrors paymentController.paymentRedirectUrl — a payment initiated before
// this field existed, or with no caller-supplied redirectUrl at all (e.g.
// hit directly rather than through web's/mobile's checkout flow), falls
// back to the mobile deep link.
function eventRedirectUrl(eventId: string, redirectUrl?: string): string {
  return redirectUrl || `planamwell://event-complete?eventId=${eventId}`;
}

function renderEventSimulationResult(success: boolean, redirectUrl: string): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>${success ? "Ticket Confirmed" : "Payment Failed"}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: sans-serif; text-align: center; padding: 40px 20px; background: #f9f9f9; }
          h2 { color: ${success ? "#15803D" : "#DC2626"}; }
          p { color: #555; }
          a { display: inline-block; margin-top: 20px; background: #D81E5B; color: #fff;
              padding: 14px 28px; border-radius: 12px; text-decoration: none; font-weight: 700; }
        </style>
      </head>
      <body>
        <h2>${success ? "Ticket Confirmed! (Simulated)" : "Payment Failed (Simulated)"}</h2>
        <p>Tap below to continue.</p>
        <a href="${redirectUrl}">Return to PlanAmWell</a>
      </body>
    </html>
  `;
}

// POST /api/v1/events/rsvp-payment/verify — real-path polling target, mirrors
// paymentController.verifyPayment's shape for the appointment/order flows.
export const verifyEventTicketPayment = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { paymentReference } = req.body;
    if (!paymentReference) {
      return res.status(400).json({ success: false, message: "paymentReference is required" });
    }

    const rsvp = await EventRsvp.findOne({ paymentReference });
    if (!rsvp) return res.status(404).json({ success: false, message: "Payment record not found" });

    if (rsvp.provider === "simulation") {
      return res.json({ success: true, data: { status: rsvp.status === "going" ? "success" : rsvp.status } });
    }

    // Real path intentionally has nothing to verify against yet — see the
    // comment on eventPaymentEnabled above. Once a real provider exists,
    // this should call its own verify endpoint the same way
    // paymentController.verifyPayment does for the Partner API.
    return res.json({ success: true, data: { status: rsvp.status === "going" ? "success" : "pending" } });
  } catch (err: any) {
    console.error("[Event] verify ticket payment error:", err.message);
    return res.status(500).json({ success: false, message: "Could not verify payment" });
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
