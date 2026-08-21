import { Request, Response } from "express";
import asyncHandler from "../middleware/asyncHandler";
import { Hospital } from "../models/hospital";
import { searchNearbyHospitals, searchHospitalsByCity } from "../services/OverpassService";
import { memoryCache } from "../util/memoryCache";

const HOSPITALS_CACHE_PREFIX = "hospitals:";
const HOSPITALS_CACHE_TTL_MS = 10 * 60 * 1000; // our own admin-curated data — write paths invalidate immediately
const OSM_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — real-world hospital locations essentially never change day to day, and we don't control writes to this external data anyway

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
  const clinics = await memoryCache.getOrSet(
    `${HOSPITALS_CACHE_PREFIX}osm:nearby:${gridLat}:${gridLng}:${parsedRadius}`,
    OSM_CACHE_TTL_MS,
    () => searchNearbyHospitals(parsedLat, parsedLng, parsedRadius)
  );
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
  const clinics = await memoryCache.getOrSet(
    `${HOSPITALS_CACHE_PREFIX}osm:city:${normalizedCity}`,
    OSM_CACHE_TTL_MS,
    () => searchHospitalsByCity(String(city).trim())
  );
  res.json({ success: true, data: clinics, total: clinics.length });
});
