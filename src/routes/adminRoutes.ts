// routes/adminRouter.ts
import express from "express";
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
    getAdminOrderDelivery,
    getAdminCommissionReport,
} from "../controllers/adminController";
import { verifyAdminToken } from "../middleware/auth";

const adminRouter = express.Router();

// ==================== PUBLIC ROUTES ====================
adminRouter.post("/adminRegister", registerAdmin);
adminRouter.post("/adminLogin", loginAdmin);

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
adminRouter.get("/orders/:orderId/delivery", verifyAdminToken, getAdminOrderDelivery);
adminRouter.get("/reports/commission", verifyAdminToken, getAdminCommissionReport);

export default adminRouter;