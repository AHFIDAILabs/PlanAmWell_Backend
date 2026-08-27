import { Schema, model, Document, Types } from "mongoose";

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
  },
  { timestamps: true }
);

export const Event = model<IEvent>("Event", EventSchema);
