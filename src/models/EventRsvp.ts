import { Schema, model, Document, Types } from "mongoose";

export interface IEventRsvp extends Document {
  eventId: Types.ObjectId;
  userId: Types.ObjectId;
  chosenName: string;
  reminderOptIn: boolean;
  reminderSent: boolean;
  // pending_payment only ever occurs for a ticketed event (Event.ticketPriceKobo
  // set) — a free event's RSVP goes straight to "going", same as before this
  // field existed. Deliberately not counted in withRsvpCounts' "going"
  // aggregate or capacity checks until payment actually completes.
  status: "going" | "cancelled" | "pending_payment";
  paymentReference?: string;
  checkoutUrl?: string;
  transactionId?: string;
  amountKobo?: number;
  provider?: "simulation" | "partner";
  // Caller-supplied web origin (see checkoutController.resolveRedirectUrl),
  // used to send the payer back to the right platform after checkout — a
  // web-initiated payment resolves this to the web app, not the mobile deep
  // link. Missing on RSVPs created before this field existed.
  redirectUrl?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const EventRsvpSchema = new Schema<IEventRsvp>(
  {
    eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    chosenName: { type: String, required: true, trim: true },
    reminderOptIn: { type: Boolean, default: false },
    reminderSent: { type: Boolean, default: false },
    status: { type: String, enum: ["going", "cancelled", "pending_payment"], default: "going" },
    paymentReference: { type: String },
    checkoutUrl: { type: String },
    transactionId: { type: String },
    amountKobo: { type: Number },
    provider: { type: String, enum: ["simulation", "partner"] },
    redirectUrl: { type: String },
  },
  { timestamps: true }
);

EventRsvpSchema.index({ eventId: 1, userId: 1 }, { unique: true });

export const EventRsvp = model<IEventRsvp>("EventRsvp", EventRsvpSchema);
