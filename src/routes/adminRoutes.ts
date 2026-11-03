// routes/adminRouter.ts
import express from "express";
import rateLimit from "express-rate-limit";
import {
    getAllDoctorsAdmin,
    updateDoctorStatus,
    registerAdmin,
    loginAdmin,
    getAllAdmins,
    getPendingDoctorsAdmin,
    getAllUsersAdmin,
    getUserByIdAdmin,
    getCombinedGrowth,
    getAdminOrders,
    getAdminOrderById,
    getAdminOrderDelivery,
    getAdminCommissionReport,
} from "../controllers/adminController";
import { verifyAdminToken } from "../middleware/auth";

const adminRouter = express.Router();

// Defense in depth even though this route now also requires an existing
// admin's own token below — caps how fast even a compromised admin account
// could mint new ones.
const adminRegisterLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many admin-registration attempts. Please try again in 1 hour." },
});

// ==================== PUBLIC ROUTES ====================
adminRouter.post("/adminLogin", loginAdmin);

// Was previously fully public — anyone could POST here and receive a signed
// Admin JWT with no invite code or approval step, a full privilege-
// escalation hole. New admins are now created by an already-authenticated
// admin, not by self-registration.
adminRouter.post("/adminRegister", verifyAdminToken, adminRegisterLimiter, registerAdmin);

// ==================== PROTECTED ROUTES ====================
adminRouter.get("/doctors", verifyAdminToken, getAllDoctorsAdmin);
adminRouter.get("/doctors/pending", verifyAdminToken, getPendingDoctorsAdmin);
adminRouter.get("/allAdmins", verifyAdminToken, getAllAdmins);
adminRouter.put("/doctors/:doctorId", verifyAdminToken, updateDoctorStatus);
adminRouter.get("/users", verifyAdminToken, getAllUsersAdmin);
adminRouter.get("/user/:userId", verifyAdminToken, getUserByIdAdmin);
adminRouter.get("/combinedGrowth", verifyAdminToken, getCombinedGrowth);

// ==================== ORDER MANAGEMENT ====================
adminRouter.get("/orders", verifyAdminToken, getAdminOrders);
adminRouter.get("/orders/:orderId", verifyAdminToken, getAdminOrderById);
adminRouter.get("/orders/:orderId/delivery", verifyAdminToken, getAdminOrderDelivery);
adminRouter.get("/reports/commission", verifyAdminToken, getAdminCommissionReport);

export default adminRouter;