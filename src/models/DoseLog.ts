import { Schema, model, Document, Types } from "mongoose";

// One row per (reminder, calendar day) a dose was marked taken — separate
// from MedicationReminder itself so "taken today" naturally resets every
// day without a cron job, and history isn't destroyed by editing the
// reminder. `date` is a plain YYYY-MM-DD string (server-clock day), not a
// Date, so the uniqueness check is a simple string match.
export interface IDoseLog extends Document {
  reminderId: Types.ObjectId;
  userId: Types.ObjectId;
  date: string;
  takenAt: Date;
}

const DoseLogSchema = new Schema<IDoseLog>(
  {
    reminderId: { type: Schema.Types.ObjectId, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    date: { type: String, required: true },
    takenAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

DoseLogSchema.index({ reminderId: 1, date: 1 }, { unique: true });

export const DoseLog = model<IDoseLog>("DoseLog", DoseLogSchema);
