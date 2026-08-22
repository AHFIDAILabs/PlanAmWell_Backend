import { Request, Response } from "express";
import asyncHandler from "../middleware/asyncHandler";
import { Hospital, IHospital } from "../models/hospital";
import { searchNearbyHospitals, resolveCityCoordinates, NormalizedClinic } from "../services/OverpassService";
import { upsertOsmClinics } from "../services/HospitalSeedService";
import { memoryCache } from "../util/memoryCache";

// Maps our own admin-curated clinics into the same shape OSM results come
// in, so the frontend renders either source identically.
function toNormalizedClinic(h: IHospital & { _id: any }): NormalizedClinic {
  return {
    _id: h._id.toString(),
    name: h.name,
    type: h.type,
    address: h.address,
    city: h.city,
    state: h.state,
    phone: h.phone,
    email: h.email,
    website: h.website,
    openingHours: h.openingHours,
    specialties: h.specialties,
    services: h.services,
    amenity: "hospital",
    coordinates: h.coordinates,
    source: "openstreetmap", // keeps the frontend's rendering path uniform
  };
}

function boundingBoxFilter(lat: number, lng: number, radiusMeters: number) {
  // 1 degree latitude is ~111km; longitude is scaled by cos(latitude) since
  // it narrows toward the poles. Approximate, but plenty for a "clinics
  // near this point" radius search.
  const latDelta = radiusMeters / 111_000;
  const lngDelta = radiusMeters / (111_000 * Math.cos((lat * Math.PI) / 180) || 1);
  return {
    "coordinates.latitude": { $gte: lat - latDelta, $lte: lat + latDelta },
    "coordinates.longitude": { $gte: lng - lngDelta, $lte: lng + lngDelta },
  };
}

async function queryLocalHospitals(filter: Record<string, any>): Promise<NormalizedClinic[]> {
  const hospitals = await Hospital.find({ isActive: true, ...filter })
    .sort({ rating: -1 })
    .limit(50)
    .lean();
  return hospitals.map((h) => toNormalizedClinic(h as any));
}

// Local-database-first, live-Overpass-as-fallback. This used to be the
// other way round (always hit Overpass live, fall back to the database
// only if every mirror failed) — but the free Overpass mirrors reliably
// start rate-limiting after just a couple of requests in quick succession
// (confirmed directly: a mirror answering in 2s on request 1 was timing
// out by request 3), so real users would see slow, sometimes-empty results
// during exactly the kind of back-to-back searching "browsing several
// cities" naturally involves. The clinic pre-warm cron job
// (cron/clinicPrewarmJob.ts) keeps this database filled in for known
// cities; a live hit here also self-seeds the database for next time, so
// coverage organically grows to match wherever users actually search.
async function findClinicsNear(lat: number, lng: number, radiusMeters: number): Promise<NormalizedClinic[]> {
  const local = await queryLocalHospitals(boundingBoxFilter(lat, lng, radiusMeters));
  if (local.length > 0) return local;

  try {
    const live = await searchNearbyHospitals(lat, lng, radiusMeters);
    if (live.length > 0) {
      upsertOsmClinics(live).catch((err) =>
        console.error("[Hospitals] Auto-seed upsert failed:", err.message)
      );
    }
    return live;
  } catch (err: any) {
    console.error("[Hospitals] Live OSM lookup failed and no local data available:", err.message);
    return [];
  }
}

const HOSPITALS_CACHE_PREFIX = "hospitals:";
const HOSPITALS_CACHE_TTL_MS = 10 * 60 * 1000; // our own admin-curated data — write paths invalidate immediately

// ── Admin-curated clinics (MongoDB) ──────────────────────────────────────────

// GET /api/v1/hospitals
export const getHospitals = asyncHandler(async (req: Request, res: Response) => {
  const { search, state, city, type, specialty, page = 1, limit = 20 } = req.query;

  const filter: any = { isActive: true };
  if (state) filter.state = { $regex: String(state), $options: "i" };
  if (city) filter.city = { $regex: String(city), $options: "i" };
  if (type) filter.type = type;
  if (specialty) {
    filter.$or = [
      { specialties: { $in: [new RegExp(String(specialty), "i")] } },
      { services: { $in: [new RegExp(String(specialty), "i")] } },
    ];
  }
  if (search) {
    const regex = new RegExp(String(search), "i");
    const searchFilter = [
      { name: regex },
      { city: regex },
      { state: regex },
      { specialties: { $in: [regex] } },
      { services: { $in: [regex] } },
    ];
    filter.$or = filter.$or ? [...filter.$or, ...searchFilter] : searchFilter;
  }

  const skip = (Number(page) - 1) * Number(limit);
  const cacheKey = `${HOSPITALS_CACHE_PREFIX}list:${JSON.stringify({ search, state, city, type, specialty, page, limit })}`;

  const { hospitals, total } = await memoryCache.getOrSet(cacheKey, HOSPITALS_CACHE_TTL_MS, async () => {
    const [hospitals, total] = await Promise.all([
      Hospital.find(filter).sort({ rating: -1, name: 1 }).skip(skip).limit(Number(limit)).lean(),
      Hospital.countDocuments(filter),
    ]);
    return { hospitals, total };
  });

  res.json({ success: true, data: hospitals, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
});

// GET /api/v1/hospitals/states
export const getClinicStates = asyncHandler(async (req: Request, res: Response) => {
  const states = await memoryCache.getOrSet(
    `${HOSPITALS_CACHE_PREFIX}states`,
    HOSPITALS_CACHE_TTL_MS,
    async () => {
      const raw = await Hospital.distinct("state", { isActive: true, state: { $ne: null } });
      return (raw as string[]).filter(Boolean).sort();
    }
  );
  res.json({ success: true, data: states });
});

// GET /api/v1/hospitals/:id  (MongoDB only — OSM detail comes via /nearby payload)
export const getHospitalById = asyncHandler(async (req: Request, res: Response) => {
  const hospital = await Hospital.findById(req.params.id).lean();
  if (!hospital || !hospital.isActive) {
    res.status(404);
    throw new Error("Clinic not found");
  }
  res.json({ success: true, data: hospital });
});

// POST /api/v1/hospitals — admin
export const createHospital = asyncHandler(async (req: Request, res: Response) => {
  const { name } = req.body;
  if (!name) { res.status(400); throw new Error("Clinic name is required"); }
  const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-");
  const hospital = await Hospital.create({ ...req.body, name, slug });
  memoryCache.invalidatePrefix(HOSPITALS_CACHE_PREFIX);
  res.status(201).json({ success: true, data: hospital });
});

// PUT /api/v1/hospitals/:id — admin
export const updateHospital = asyncHandler(async (req: Request, res: Response) => {
  const hospital = await Hospital.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!hospital) { res.status(404); throw new Error("Clinic not found"); }
  memoryCache.invalidatePrefix(HOSPITALS_CACHE_PREFIX);
  res.json({ success: true, data: hospital });
});

// DELETE /api/v1/hospitals/:id — admin
export const deleteHospital = asyncHandler(async (req: Request, res: Response) => {
  const hospital = await Hospital.findByIdAndDelete(req.params.id);
  if (!hospital) { res.status(404); throw new Error("Clinic not found"); }
  memoryCache.invalidatePrefix(HOSPITALS_CACHE_PREFIX);
  res.json({ success: true, message: "Clinic removed successfully" });
});

// ── Real-world data via OpenStreetMap Overpass API (free, no key needed) ─────

/**
 * GET /api/v1/hospitals/nearby?lat=6.52&lng=3.38&radius=5000
 * Returns real hospitals near a GPS coordinate from OpenStreetMap.
 * radius is capped at 20 km.
 */
export const getNearbyHospitals = asyncHandler(async (req: Request, res: Response) => {
  const { lat, lng, radius = "5000" } = req.query;

  if (!lat || !lng) {
    res.status(400);
    throw new Error("lat and lng query parameters are required");
  }

  const parsedLat = parseFloat(String(lat));
  const parsedLng = parseFloat(String(lng));
  const parsedRadius = Math.min(parseInt(String(radius), 10), 20_000);

  if (isNaN(parsedLat) || isNaN(parsedLng)) {
    res.status(400);
    throw new Error("lat and lng must be valid numbers");
  }

  const clinics = await findClinicsNear(parsedLat, parsedLng, parsedRadius);
  res.json({ success: true, data: clinics, total: clinics.length });
});

/**
 * GET /api/v1/hospitals/by-city?city=Lagos
 * Resolves the city to coordinates (known-city table or Nominatim), then
 * searches the local database first, live OSM as a fallback — same
 * local-first strategy as getNearbyHospitals, see findClinicsNear above.
 */
export const getHospitalsByCity = asyncHandler(async (req: Request, res: Response) => {
  const { city } = req.query;
  const trimmedCity = String(city ?? "").trim();

  if (!trimmedCity) {
    res.status(400);
    throw new Error("city query parameter is required");
  }

  let coords: { lat: number; lon: number } | null;
  try {
    coords = await resolveCityCoordinates(trimmedCity);
  } catch (err: any) {
    // Nominatim failed outright (no coordinates to search around at all) —
    // last resort is whatever the local database has tagged with this city
    // name directly, since a bounding-box search needs coordinates we
    // don't have here.
    console.error("[Hospitals] City geocoding failed, falling back to local city-name match:", err.message);
    const clinics = await queryLocalHospitals({ city: { $regex: trimmedCity, $options: "i" } });
    res.json({ success: true, data: clinics, total: clinics.length });
    return;
  }

  if (!coords) {
    // Genuinely no such place, per Nominatim — not a failure, just zero results.
    res.json({ success: true, data: [], total: 0 });
    return;
  }

  const clinics = await findClinicsNear(coords.lat, coords.lon, 10_000);
  res.json({ success: true, data: clinics, total: clinics.length });
});
