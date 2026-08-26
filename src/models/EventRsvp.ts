import { Schema, model, Document, Types } from "mongoose";

export interface IEventRsvp extends Document {
  eventId: Types.ObjectId;
  userId: Types.ObjectId;
  chosenName: string;
  reminderOptIn: boolean;
  reminderSent: boolean;
  status: "going" | "cancelled";
}

const EventRsvpSchema = new Schema<IEventRsvp>(
  {
    eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    chosenName: { type: String, required: true, trim: true },
    reminderOptIn: { type: Boolean, default: false },
    reminderSent: { type: Boolean, default: false },
    status: { type: String, enum: ["going", "cancelled"], default: "going" },
  },
  { timestamps: true }
);

EventRsvpSchema.index({ eventId: 1, userId: 1 }, { unique: true });

export const EventRsvp = model<IEventRsvp>("EventRsvp", EventRsvpSchema);
