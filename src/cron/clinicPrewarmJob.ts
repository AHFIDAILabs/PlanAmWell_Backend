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

const SEARCH_RADIUS_METERS = 10_000;
const DELAY_BETWEEN_CITIES_MS = 10_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function prewarmAllCities(): Promise<void> {
  const cities = Object.entries(KNOWN_CITY_COORDS);
  console.log(`[ClinicPrewarm] Starting sweep of ${cities.length} cities`);

  let succeeded = 0;
  let failed = 0;

  for (const [city, { lat, lon }] of cities) {
    try {
      const clinics = await searchNearbyHospitals(lat, lon, SEARCH_RADIUS_METERS);
      await upsertOsmClinics(clinics);
      console.log(`[ClinicPrewarm] ${city}: saved ${clinics.length} clinics`);
      succeeded++;
    } catch (err: any) {
      // One city failing (e.g. every mirror briefly down) shouldn't abort
      // the whole sweep — the next scheduled run will retry it.
      console.error(`[ClinicPrewarm] ${city}: failed —`, err.message);
      failed++;
    }
    await sleep(DELAY_BETWEEN_CITIES_MS);
  }

  console.log(`[ClinicPrewarm] Sweep complete: ${succeeded} succeeded, ${failed} failed`);
}

// Every 6 hours — matches the assumption already used for OSM cache TTLs
// elsewhere (hospitalController.ts): real-world hospital locations don't
// change day to day, so refreshing more often than this buys nothing.
cron.schedule("0 */6 * * *", () => {
  prewarmAllCities().catch((err) => console.error("[ClinicPrewarm] Sweep threw:", err));
});
