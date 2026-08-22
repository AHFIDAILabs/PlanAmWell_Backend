// services/HospitalSeedService.ts
//
// Turns live OpenStreetMap lookups into persisted Hospital records, so
// clinic search stops depending on Overpass being reachable/fast at the
// moment a user makes a request. Used by:
//   - cron/clinicPrewarmJob.ts — a scheduled sweep of known cities
//   - hospitalController.ts — an on-demand top-up whenever a live lookup
//     succeeds for an area not yet in the local database
//
// Upserts are keyed on `osmId` (not name/slug) so re-running this never
// touches admin-curated hospitals, which don't have that field set.
import { Hospital } from "../models/hospital";
import { NormalizedClinic } from "./OverpassService";

function slugFor(clinic: NormalizedClinic): string {
  const base = clinic.name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-");
  // osmId (e.g. "osm_node_123456") is already unique per place, so
  // appending its digits guarantees slug uniqueness even when many clinics
  // share a generic name like "General Hospital".
  const suffix = clinic._id.replace(/[^a-z0-9]/gi, "");
  return `${base}-${suffix}`;
}

export async function upsertOsmClinics(clinics: NormalizedClinic[]): Promise<void> {
  if (!clinics.length) return;

  const bulkOps = clinics
    .filter((c) => c.coordinates) // a hospital record with no location isn't useful for nearby/city search
    .map((c) => ({
      updateOne: {
        filter: { osmId: c._id },
        update: {
          $set: {
            name: c.name,
            type: c.type,
            address: c.address,
            city: c.city,
            state: c.state,
            phone: c.phone,
            email: c.email,
            website: c.website,
            openingHours: c.openingHours,
            specialties: c.specialties,
            services: c.services,
            coordinates: c.coordinates,
            isActive: true,
          },
          $setOnInsert: { osmId: c._id, slug: slugFor(c) },
        },
        upsert: true,
      },
    }));

  if (!bulkOps.length) return;

  // ordered: false — one bad doc (e.g. a slug collision) shouldn't abort
  // upserting the rest of the batch.
  await Hospital.bulkWrite(bulkOps, { ordered: false }).catch((err) => {
    console.error("[HospitalSeed] bulkWrite had errors (partial success is normal):", err.message);
  });
}
