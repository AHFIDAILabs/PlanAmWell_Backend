import express from "express";
import {
  getHospitals,
  getClinicStates,
  getHospitalById,
  createHospital,
  updateHospital,
  deleteHospital,
  getNearbyHospitals,
  getHospitalsByCity,
} from "../controllers/hospitalController";
import { verifyAdminToken, authorize } from "../middleware/auth";

const hospitalRouter = express.Router();

// ── OpenStreetMap (real-world, public) ──────────────────────────────
// These must come before /:id so "nearby" and "by-city" aren't treated as IDs
hospitalRouter.get("/nearby", getNearbyHospitals);
hospitalRouter.get("/by-city", getHospitalsByCity);

// ── Admin-curated clinics (MongoDB, public read) ─────────────────────
hospitalRouter.get("/states", getClinicStates);
hospitalRouter.get("/", getHospitals);
hospitalRouter.get("/:id", getHospitalById);

// ── Admin write ───────────────────────────────────────────────────────
hospitalRouter.post("/", verifyAdminToken, authorize("Admin"), createHospital);
hospitalRouter.put("/:id", verifyAdminToken, authorize("Admin"), updateHospital);
hospitalRouter.delete("/:id", verifyAdminToken, authorize("Admin"), deleteHospital);

export default hospitalRouter;
