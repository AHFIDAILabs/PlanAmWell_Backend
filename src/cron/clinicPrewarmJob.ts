// cron/clinicPrewarmJob.ts
//
// Sweeps every known city (see OverpassService.KNOWN_CITY_COORDS) against
// live OpenStreetMap data and saves the results into the Hospital
// collection, on a schedule — so real user requests hit our own fast,
// reliable database instead of racing live against free Overpass mirrors
// that reliably start rate-limiting after just a couple of rapid requests.
//
// Deliberately slow and sequential: a fixed delay between cities, one at a
// time, is the whole point — the goal is to be a well-behaved, low-volume
// consumer of a free shared resource, not to refresh as fast as possible.
import cron from "node-cron";
import { searchNearbyHospitals, KNOWN_CITY_COORDS } from "../services/OverpassService";
import { upsertOsmClinics } from "../services/HospitalSeedService";
import { Hospital } from "../models/hospital";

const SEARCH_RADIUS_METERS = 10_000;
const DELAY_BETWEEN_CITIES_MS = 10_000;
// Slightly larger than SEARCH_RADIUS_METERS so a city already seeded from a
// nearby point still counts as "covered" instead of being re-fetched.
const COVERAGE_CHECK_RADIUS_METERS = 15_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Same bounding-box approach as hospitalController.ts's local-first lookup —
// duplicated here rather than imported, since importing a controller into a
// cron job would be the wrong direction of dependency.
function boundingBoxFilter(lat: number, lng: number, radiusMeters: number) {
  const latDelta = radiusMeters / 111_000;
  const lngDelta = radiusMeters / (111_000 * Math.cos((lat * Math.PI) / 180) || 1);
  return {
    "coordinates.latitude": { $gte: lat - latDelta, $lte: lat + latDelta },
    "coordinates.longitude": { $gte: lng - lngDelta, $lte: lng + lngDelta },
  };
}

async function hasLocalCoverage(lat: number, lon: number): Promise<boolean> {
  const doc = await Hospital.exists({ isActive: true, ...boundingBoxFilter(lat, lon, COVERAGE_CHECK_RADIUS_METERS) });
  return doc !== null;
}

async function prewarmCity(city: string, lat: number, lon: number): Promise<boolean> {
  try {
    const clinics = await searchNearbyHospitals(lat, lon, SEARCH_RADIUS_METERS);
    await upsertOsmClinics(clinics);
    console.log(`[ClinicPrewarm] ${city}: saved ${clinics.length} clinics`);
    return true;
  } catch (err: any) {
    // One city failing (e.g. every mirror briefly down) shouldn't abort
    // the whole sweep — the next scheduled run will retry it.
    console.error(`[ClinicPrewarm] ${city}: failed —`, err.message);
    return false;
  }
}

async function prewarmAllCities(): Promise<void> {
  const cities = Object.entries(KNOWN_CITY_COORDS);
  console.log(`[ClinicPrewarm] Starting full sweep of ${cities.length} cities`);

  let succeeded = 0;
  let failed = 0;

  for (const [city, { lat, lon }] of cities) {
    (await prewarmCity(city, lat, lon)) ? succeeded++ : failed++;
    await sleep(DELAY_BETWEEN_CITIES_MS);
  }

  console.log(`[ClinicPrewarm] Full sweep complete: ${succeeded} succeeded, ${failed} failed`);
}

/**
 * Seeds only the known cities that currently have zero local coverage.
 * Call once, explicitly, right after the DB connects (see index.ts) — never
 * at module-import time, since Mongo isn't connected yet then.
 *
 * This exists because the fixed `0 * / 6 * * *` schedule below silently
 * never seeds anything on a host that isn't continuously running across one
 * of those exact UTC boundaries (e.g. a free-tier instance that spins down
 * between requests). Confirmed directly against production: every existing
 * Hospital document was Abuja-only, from a single manual seedHospitals.ts
 * run — the cron had evidently never actually completed a sweep. Checking
 * coverage first (rather than always re-running all known cities) keeps
 * this safe to call on every restart without re-hammering the free Overpass
 * mirrors for cities that are already seeded.
 */
export async function prewarmMissingCitiesOnStartup(): Promise<void> {
  const cities = Object.entries(KNOWN_CITY_COORDS);
  const missing: typeof cities = [];

  for (const [city, coords] of cities) {
    if (!(await hasLocalCoverage(coords.lat, coords.lon))) {
      missing.push([city, coords]);
    }
  }

  if (missing.length === 0) {
    console.log("[ClinicPrewarm] Startup check: all known cities already have local coverage");
    return;
  }

  console.log(
    `[ClinicPrewarm] Startup check: ${missing.length}/${cities.length} cities missing local coverage — seeding now`
  );
  let succeeded = 0;
  let failed = 0;
  for (const [city, { lat, lon }] of missing) {
    (await prewarmCity(city, lat, lon)) ? succeeded++ : failed++;
    await sleep(DELAY_BETWEEN_CITIES_MS);
  }
  console.log(`[ClinicPrewarm] Startup seed complete: ${succeeded} succeeded, ${failed} failed`);
}

// Every 6 hours — matches the assumption already used for OSM cache TTLs
// elsewhere (hospitalController.ts): real-world hospital locations don't
// change day to day, so refreshing more often than this buys nothing.
cron.schedule("0 */6 * * *", () => {
  prewarmAllCities().catch((err) => console.error("[ClinicPrewarm] Sweep threw:", err));
});
