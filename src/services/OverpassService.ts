/**
 * OverpassService.ts
 * Fetches real hospitals and clinics from OpenStreetMap via the Overpass API.
 * Completely free — no API key required.
 * Nominatim is used for city-name → coordinates geocoding.
 */

import axios from "axios";

// The free public overpass-api.de instance is well known to be unreliable
// under its own load — it returns a hard 504 ("server too busy") when
// overloaded, which axios throws on and the loop below correctly treats as
// a failure. Several independently-run public mirrors exist precisely
// because of this; trying them in sequence turns an intermittent
// single-instance failure into something that only fails if ALL are down.
//
// overpass.osm.ch is deliberately NOT in this list — verified directly
// (curl, both Lagos and Abuja queries) that it returns a syntactically
// valid HTTP 200 with a well-formed but ALWAYS-EMPTY `elements: []`,
// regardless of the query. That's worse than an honest failure: nothing in
// queryOverpass's error handling can distinguish "this mirror is lying"
// from "genuinely zero results here", so it silently poisoned every single
// lookup when it was first in this list. Do not re-add it without directly
// verifying it returns real data for a location known to have OSM entries.
const OVERPASS_URLS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

// No caching in this file — hospitalController.ts caches at the HTTP layer
// in front of both exported functions below (a coarser ~1.1km GPS grid, 6h
// TTL, shared with the by-city path). This service is just "fetch fresh";
// caching policy belongs to the caller, not duplicated here too.

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NormalizedClinic {
  _id: string;
  name: string;
  type?: "public" | "private" | "NGO";
  address?: string;
  city?: string;
  state?: string;
  phone?: string;
  email?: string;
  website?: string;
  openingHours?: string;
  specialties?: string[];
  services?: string[];
  amenity?: string;
  emergency?: boolean;
  coordinates?: { latitude: number; longitude: number };
  source: "openstreetmap";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function inferType(tags: Record<string, string>): "public" | "private" | "NGO" | undefined {
  const raw = [tags.operator_type, tags.ownership, tags.operator]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/government|federal|state\s+gov|ministry|lga|public/.test(raw)) return "public";
  if (/ngo|charity|foundation|mission|church|red cross|community|non.profit/.test(raw)) return "NGO";
  if (/private/.test(raw)) return "private";
  return undefined;
}

function buildAddress(tags: Record<string, string>): string | undefined {
  const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
  return street || tags["addr:full"] || undefined;
}

function parseSpecialties(tags: Record<string, string>): string[] {
  const raw = tags["healthcare:speciality"] || tags["medical_speciality"] || "";
  return raw
    ? raw.split(";").map((s) => s.trim().replace(/_/g, " ")).filter(Boolean)
    : [];
}

function normalizeElement(el: any): NormalizedClinic | null {
  const tags: Record<string, string> = el.tags || {};
  const name = tags.name || tags["name:en"];
  if (!name) return null; // skip unnamed facilities

  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;

  return {
    _id: `osm_${el.type}_${el.id}`,
    name,
    type: inferType(tags),
    address: buildAddress(tags),
    city: tags["addr:city"] || tags["addr:town"] || tags["addr:village"] || undefined,
    state: tags["addr:state"] || undefined,
    phone: tags.phone || tags["contact:phone"] || tags["phone"] || undefined,
    email: tags.email || tags["contact:email"] || undefined,
    website: tags.website || tags["contact:website"] || undefined,
    openingHours: tags.opening_hours || undefined,
    specialties: parseSpecialties(tags),
    amenity: tags.amenity || tags.healthcare || undefined,
    emergency: tags.emergency === "yes",
    coordinates: lat != null && lon != null ? { latitude: lat, longitude: lon } : undefined,
    source: "openstreetmap",
  };
}

function deduplicateByName(clinics: NormalizedClinic[]): NormalizedClinic[] {
  const seen = new Set<string>();
  return clinics.filter((c) => {
    const key = `${c.name.toLowerCase().replace(/\s+/g, "")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Overpass query builder ────────────────────────────────────────────────

function buildNearbyQuery(lat: number, lng: number, radius: number): string {
  const area = `(around:${radius},${lat},${lng})`;
  return `
[out:json][timeout:25];
(
  node["amenity"~"^(hospital|clinic|doctors|health_post|healthcare_centre)$"]${area};
  way["amenity"~"^(hospital|clinic|doctors|health_post|healthcare_centre)$"]${area};
  node["healthcare"~"^(hospital|clinic|doctor|centre|center|maternity)$"]${area};
  way["healthcare"~"^(hospital|clinic|doctor|centre|center|maternity)$"]${area};
);
out center tags;
  `.trim();
}

// ─── Overpass query execution with mirror fallback ─────────────────────────

/**
 * Runs `query` against each mirror in OVERPASS_URLS in turn, moving to the
 * next one on any failure — a hard error (network, 5xx/504) or a "soft"
 * failure: Overpass can return HTTP 200 with a `remark` field describing a
 * timeout and an empty/truncated `elements` array, which otherwise looks
 * indistinguishable from a genuine "no results in this area" response.
 * Throws only if every mirror fails.
 */
async function queryOverpass(query: string): Promise<any[]> {
  let lastError: any;

  for (const url of OVERPASS_URLS) {
    try {
      const response = await axios.post(
        url,
        `data=${encodeURIComponent(query)}`,
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "PlanAmWell/1.0 (health app; contact@planamwell.com)",
          },
          timeout: 30_000,
        }
      );

      if (response.data?.remark) {
        // Present even on a 200 — Overpass hit its own internal query
        // timeout and returned whatever partial result it had, which is not
        // the same thing as "we searched properly and found nothing."
        throw new Error(`Overpass remark (soft failure): ${response.data.remark}`);
      }

      return response.data?.elements ?? [];
    } catch (err: any) {
      lastError = err;
      console.warn(`[Overpass] Mirror failed (${url}):`, err.message);
      // fall through to the next mirror
    }
  }

  throw lastError;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Search for real hospitals and clinics within `radiusMeters` of a GPS point.
 */
export async function searchNearbyHospitals(
  lat: number,
  lng: number,
  radiusMeters = 5000
): Promise<NormalizedClinic[]> {
  try {
    console.log(`[Overpass] Querying hospitals near (${lat}, ${lng}) within ${radiusMeters}m`);
    const query = buildNearbyQuery(lat, lng, radiusMeters);
    const elements = await queryOverpass(query);

    const clinics = deduplicateByName(
      elements.map(normalizeElement).filter((c): c is NormalizedClinic => c !== null)
    );

    console.log(`[Overpass] Found ${clinics.length} clinics near (${lat}, ${lng})`);
    return clinics;
  } catch (err: any) {
    console.error("[Overpass] searchNearbyHospitals error:", err.message);
    throw err;
  }
}

/**
 * Geocode a Nigerian city or state name via Nominatim, then search for
 * hospitals within 10 km of the city centre.
 */
export async function searchHospitalsByCity(cityName: string): Promise<NormalizedClinic[]> {
  const normalised = cityName.trim();

  // Step 1: Geocode the city with Nominatim
  console.log(`[Nominatim] Geocoding: "${normalised}"`);
  const geoRes = await axios.get(NOMINATIM_URL, {
    params: {
      q: `${normalised}, Nigeria`,
      format: "json",
      limit: 1,
      countrycodes: "ng",
    },
    headers: {
      "User-Agent": "PlanAmWell/1.0 (health app; contact@planamwell.com)",
    },
    timeout: 10_000,
  });

  const places = geoRes.data as any[];
  if (!places.length) {
    console.warn(`[Nominatim] No results for "${normalised}"`);
    return [];
  }

  const { lat, lon } = places[0];
  console.log(`[Nominatim] "${normalised}" → (${lat}, ${lon})`);

  // Step 2: Search hospitals within 10 km of that city centre
  return searchNearbyHospitals(parseFloat(lat), parseFloat(lon), 10_000);
}
