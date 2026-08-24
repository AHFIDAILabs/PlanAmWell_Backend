import { Schema, model, Document, Types } from "mongoose";

export interface IMedicationReminder extends Document {
  userId: Types.ObjectId;
  userType: "User" | "Doctor";
  drugName: string;
  dosage: string;
  frequency: "once_daily" | "twice_daily" | "three_times_daily" | "four_times_daily" | "as_needed";
  times: string[]; // HH:mm strings
  instructions?: string;
  color: string;
  isActive: boolean;
  startDate: Date;
  endDate?: Date;
  displayAlias?: string;
}

const MedicationReminderSchema = new Schema<IMedicationReminder>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    userType: { type: String, enum: ["User", "Doctor"], required: true },
    drugName: { type: String, required: true, trim: true },
    dosage: { type: String, default: "" },
    frequency: {
      type: String,
      enum: ["once_daily", "twice_daily", "three_times_daily", "four_times_daily", "as_needed"],
      default: "once_daily",
    },
    times: [{ type: String }],
    instructions: { type: String },
    color: { type: String, default: "#00897B" },
    isActive: { type: Boolean, default: true },
    startDate: { type: Date, default: Date.now },
    endDate: { type: Date },
    displayAlias: { type: String, trim: true },
  },
  { timestamps: true }
);

export const MedicationReminder = model<IMedicationReminder>(
  "MedicationReminder",
  MedicationReminderSchema
);
