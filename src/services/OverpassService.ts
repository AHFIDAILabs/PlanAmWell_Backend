/**
 * OverpassService.ts
 * Fetches real hospitals and clinics from OpenStreetMap via the Overpass API.
 * Completely free — no API key required.
 * Nominatim is used for city-name → coordinates geocoding.
 */

import axios from "axios";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

// 1-hour in-memory cache keyed by a rounded location string
const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { data: NormalizedClinic[]; expiresAt: number }>();

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

function cacheKey(lat: number, lng: number, radius: number): string {
  // Round to ~100 m precision to maximise cache hits
  return `${Math.round(lat * 100) / 100}_${Math.round(lng * 100) / 100}_${radius}`;
}

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

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Search for real hospitals and clinics within `radiusMeters` of a GPS point.
 * Results are cached for 1 hour.
 */
export async function searchNearbyHospitals(
  lat: number,
  lng: number,
  radiusMeters = 5000
): Promise<NormalizedClinic[]> {
  const key = cacheKey(lat, lng, radiusMeters);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    console.log(`[Overpass] Cache hit: ${key}`);
    return cached.data;
  }

  try {
    console.log(`[Overpass] Querying hospitals near (${lat}, ${lng}) within ${radiusMeters}m`);
    const query = buildNearbyQuery(lat, lng, radiusMeters);
    const response = await axios.post(
      OVERPASS_URL,
      `data=${encodeURIComponent(query)}`,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "PlanAmWell/1.0 (health app; contact@planamwell.com)",
        },
        timeout: 30_000,
      }
    );

    const elements: any[] = response.data?.elements ?? [];
    const clinics = deduplicateByName(
      elements.map(normalizeElement).filter((c): c is NormalizedClinic => c !== null)
    );

    cache.set(key, { data: clinics, expiresAt: Date.now() + CACHE_TTL_MS });
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
  const cityCacheKey = `city_${normalised.toLowerCase().replace(/\s+/g, "_")}`;
  const cached = cache.get(cityCacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    console.log(`[Overpass] Cache hit: ${cityCacheKey}`);
    return cached.data;
  }

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
  const clinics = await searchNearbyHospitals(parseFloat(lat), parseFloat(lon), 10_000);

  // Also cache under the city key with a shorter TTL (6 hours)
  cache.set(cityCacheKey, { data: clinics, expiresAt: Date.now() + 6 * 60 * 60 * 1000 });

  return clinics;
}
