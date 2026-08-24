// models/platformSettings.ts
//
// A singleton document — always upserted against the same fixed _id, never
// created more than once. Holds platform-wide config that should be
// changeable by an admin without a redeploy; today that's just the flat
// consultation fee.

import mongoose, { Document, Schema } from "mongoose";

export const PLATFORM_SETTINGS_ID = "platform-settings";

export interface IPlatformSettings extends Document {
  _id: string;
  consultationFeeKobo: number;
  currency: string;
  updatedAt: Date;
  updatedBy?: mongoose.Types.ObjectId;
}

const PlatformSettingsSchema = new Schema<IPlatformSettings>(
  {
    _id: { type: String, default: PLATFORM_SETTINGS_ID },
    consultationFeeKobo: { type: Number, required: true, default: 1_500_000 }, // ₦15,000, matching today's hardcoded UI value
    currency: { type: String, default: "NGN" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
  },
  { timestamps: { createdAt: false, updatedAt: true } }
);

export const PlatformSettings = mongoose.model<IPlatformSettings>("PlatformSettings", PlatformSettingsSchema);
