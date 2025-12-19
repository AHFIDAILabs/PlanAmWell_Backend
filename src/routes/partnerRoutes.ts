// routes/partnerRouter.ts
import express from "express";
import {
  createPartner,
  getAllPartners,
  getPartnerById,
  updatePartner,
  deletePartner,
  togglePartnerStatus,
  getActivePartners,
  getPartnerStats,
} from "../controllers/partnerController";
import { verifyAdminToken } from "../middleware/auth";



import multer from "multer";

const upload = multer({ storage: multer.memoryStorage() });


const partnerRouter = express.Router();

// ==================== PUBLIC ROUTES ====================
// Anyone can view active partners
partnerRouter.get("/active", getActivePartners);

// ==================== ADMIN-ONLY ROUTES ====================
// Create a new partner
partnerRouter.post("/", verifyAdminToken, upload.single("image"), createPartner);

// Get all partners (with filters)
partnerRouter.get("/", verifyAdminToken, getAllPartners);

// Get partner statistics
partnerRouter.get("/stats", verifyAdminToken, getPartnerStats);

// Get single partner by ID
partnerRouter.get("/:partnerId", verifyAdminToken, getPartnerById);

// Update partner
partnerRouter.put("/:partnerId", verifyAdminToken, upload.single("image"), updatePartner);

// Delete partner
partnerRouter.delete("/:partnerId", verifyAdminToken, deletePartner);

// Toggle partner active status
partnerRouter.patch("/:partnerId/toggle-status", verifyAdminToken, togglePartnerStatus);

export default partnerRouter;