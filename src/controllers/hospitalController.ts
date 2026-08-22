import { Request, Response } from "express";
import asyncHandler from "../middleware/asyncHandler";
import { Hospital, IHospital } from "../models/hospital";
import { searchNearbyHospitals, searchHospitalsByCity, NormalizedClinic } from "../services/OverpassService";
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

// All OSM mirrors are free, best-effort, third-party infrastructure — when
// every one of them is unreachable (seen in production: overpass-api.de
// throttles Render's IP specifically while the others are intermittently
// down), falling through to whatever admin-curated clinics we have locally
// beats returning nothing to a user standing in front of "Find a Clinic".
async function localHospitalFallback(filter: Record<string, any>): Promise<NormalizedClinic[]> {
  const hospitals = await Hospital.find({ isActive: true, ...filter })
    .sort({ rating: -1 })
    .limit(50)
    .lean();
  return hospitals.map((h) => toNormalizedClinic(h as any));
}

const HOSPITALS_CACHE_PREFIX = "hospitals:";
const HOSPITALS_CACHE_TTL_MS = 10 * 60 * 1000; // our own admin-curated data — write paths invalidate immediately
const OSM_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — real-world hospital locations essentially never change day to day, and we don't control writes to this external data anyway
// Short on purpose — a fallback result (all OSM mirrors down) is a degraded
// answer, not a genuine one, and must NOT sit in cache for the same 6h as a
// real result. getOrSet can't express two different TTLs for the same key
// depending on which branch the fetcher took, so nearby/by-city below manage
// the cache manually instead of through getOrSet for this reason.
const FALLBACK_CACHE_TTL_MS = 2 * 60 * 1000;

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

  // Round to ~1.1km grid so nearby users hitting slightly different exact
  // coordinates still share a cache entry instead of each making their own
  // Overpass call for what's effectively the same search area.
  const gridLat = parsedLat.toFixed(2);
  const gridLng = parsedLng.toFixed(2);
  const cacheKey = `${HOSPITALS_CACHE_PREFIX}osm:nearby:${gridLat}:${gridLng}:${parsedRadius}`;

  let clinics = memoryCache.get<NormalizedClinic[]>(cacheKey);
  if (clinics === undefined) {
    try {
      clinics = await searchNearbyHospitals(parsedLat, parsedLng, parsedRadius);
      memoryCache.set(cacheKey, clinics, OSM_CACHE_TTL_MS);
    } catch (err: any) {
      console.error("[Hospitals] All OSM mirrors failed, falling back to local database:", err.message);
      // Rough bounding-box approximation — good enough for a degraded
      // fallback; 1 degree latitude is ~111km, longitude scaled by
      // cos(latitude) since it narrows toward the poles.
      const latDelta = parsedRadius / 111_000;
      const lngDelta = parsedRadius / (111_000 * Math.cos((parsedLat * Math.PI) / 180) || 1);
      clinics = await localHospitalFallback({
        "coordinates.latitude": { $gte: parsedLat - latDelta, $lte: parsedLat + latDelta },
        "coordinates.longitude": { $gte: parsedLng - lngDelta, $lte: parsedLng + lngDelta },
      });
      // Short TTL — a degraded answer, not a real one; the next request
      // should retry OSM soon rather than being stuck behind this for 6h.
      memoryCache.set(cacheKey, clinics, FALLBACK_CACHE_TTL_MS);
    }
  }
  res.json({ success: true, data: clinics, total: clinics.length });
});

/**
 * GET /api/v1/hospitals/by-city?city=Lagos
 * Geocodes the city via Nominatim then queries Overpass within 10 km.
 */
export const getHospitalsByCity = asyncHandler(async (req: Request, res: Response) => {
  const { city } = req.query;

  if (!city || !String(city).trim()) {
    res.status(400);
    throw new Error("city query parameter is required");
  }

  const normalizedCity = String(city).trim().toLowerCase();
  const cacheKey = `${HOSPITALS_CACHE_PREFIX}osm:city:${normalizedCity}`;

  let clinics = memoryCache.get<NormalizedClinic[]>(cacheKey);
  if (clinics === undefined) {
    try {
      clinics = await searchHospitalsByCity(String(city).trim());
      memoryCache.set(cacheKey, clinics, OSM_CACHE_TTL_MS);
    } catch (err: any) {
      console.error("[Hospitals] All OSM mirrors failed, falling back to local database:", err.message);
      clinics = await localHospitalFallback({ city: { $regex: String(city).trim(), $options: "i" } });
      memoryCache.set(cacheKey, clinics, FALLBACK_CACHE_TTL_MS);
    }
  }
  res.json({ success: true, data: clinics, total: clinics.length });
});
