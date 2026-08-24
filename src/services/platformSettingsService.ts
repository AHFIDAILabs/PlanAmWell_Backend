// services/platformSettingsService.ts
//
// Thin cache in front of the PlatformSettings singleton — this gets read on
// every consultation booking, so avoid a DB round-trip for a value that
// rarely changes. Cache is invalidated on write.

import { PlatformSettings, PLATFORM_SETTINGS_ID, IPlatformSettings } from "../models/platformSettings";

let cached: IPlatformSettings | null = null;

export async function getPlatformSettings(): Promise<IPlatformSettings> {
  if (cached) return cached;

  const settings = await PlatformSettings.findOneAndUpdate(
    { _id: PLATFORM_SETTINGS_ID },
    { $setOnInsert: { _id: PLATFORM_SETTINGS_ID } },
    { new: true, upsert: true }
  );

  cached = settings;
  return settings;
}

export async function updatePlatformSettings(
  data: { consultationFeeKobo?: number; currency?: string },
  updatedBy?: string
): Promise<IPlatformSettings> {
  const settings = await PlatformSettings.findOneAndUpdate(
    { _id: PLATFORM_SETTINGS_ID },
    { $set: { ...data, ...(updatedBy ? { updatedBy } : {}) } },
    { new: true, upsert: true }
  );

  cached = settings;
  return settings;
}
