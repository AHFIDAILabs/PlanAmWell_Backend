import { Schema, model, Document, Types } from "mongoose";
import crypto from "crypto";

// Fixed, known set of built-in illustrated banners an admin can pick instead
// of uploading their own photo — kept in sync by hand with the same list in
// web/src/lib/types.ts (EVENT_BANNER_PRESETS) and the admin dashboard's
// picker, since each key must correspond to a real graphic the clients know
// how to render. Not a place for free-text.
export const EVENT_BANNER_PRESETS = ["support-circle", "workshop", "qa-session", "wellness", "celebration"] as const;
export type EventBannerPreset = (typeof EVENT_BANNER_PRESETS)[number];

export interface IEvent extends Document {
  title: string;
  description: string;
  category?: string;
  startsAt: Date;
  endsAt?: Date;
  location?: string;
  isVirtual: boolean;
  capacity?: number;
  createdBy: Types.ObjectId;
  isActive: boolean;
  // Mutually exclusive in practice — an uploaded photo takes precedence over
  // a preset if somehow both are set (see eventController's write path,
  // which always clears the other when one is set).
  bannerImage?: { url: string; publicId?: string };
  bannerPreset?: EventBannerPreset;

  // ── Monetization: registration handoff + paid tickets ──────────────────
  // Who's actually running this event — shown to patients, distinct from
  // "createdBy" which is always the admin who entered the listing.
  organizerName?: string;
  // External registration page (organizer-owned) — opened in an in-app
  // browser rather than our own form collecting attendee PII, deliberately:
  // see the design note in eventController for why.
  registrationUrl?: string;
  // Auto-generated, appended as a query param when opening registrationUrl
  // so an organizer who checks their own referrer/UTM data can attribute
  // signups back to PlanAmWell — best-effort, we can't verify completion on
  // a site we don't control.
  referralCode: string;
  // Admin-set after an out-of-band arrangement with the organizer (no
  // self-serve payment for this yet) — surfaces the listing more
  // prominently. Independent of ticketPriceKobo below.
  isPaidPlacement: boolean;
  // Undefined/0 = free event (today's behavior, RSVP unchanged). When set,
  // RSVPing requires payment first — see rsvpToEvent/initiateEventPayment.
  ticketPriceKobo?: number;
}

const EventSchema = new Schema<IEvent>(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    category: { type: String, trim: true },
    startsAt: { type: Date, required: true, index: true },
    endsAt: { type: Date },
    location: { type: String, trim: true },
    isVirtual: { type: Boolean, default: false },
    capacity: { type: Number, min: 1 },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    isActive: { type: Boolean, default: true },
    bannerImage: {
      url: { type: String },
      publicId: { type: String },
    },
    bannerPreset: { type: String, enum: EVENT_BANNER_PRESETS },
    organizerName: { type: String, trim: true },
    registrationUrl: { type: String, trim: true },
    referralCode: {
      type: String,
      default: () => crypto.randomBytes(4).toString("hex"),
      unique: true,
    },
    isPaidPlacement: { type: Boolean, default: false },
    ticketPriceKobo: { type: Number, min: 0 },
  },
  { timestamps: true }
);

export const Event = model<IEvent>("Event", EventSchema);
