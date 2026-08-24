// routes/platformSettingsRoutes.ts
import express from "express";
import { getPlatformSettingsHandler, updatePlatformSettingsHandler } from "../controllers/platformSettingsController";
import { verifyAdminToken, authorize } from "../middleware/auth";

const platformSettingsRouter = express.Router();

platformSettingsRouter.get("/", getPlatformSettingsHandler);
platformSettingsRouter.put("/", verifyAdminToken, authorize("Admin"), updatePlatformSettingsHandler);

export default platformSettingsRouter;
