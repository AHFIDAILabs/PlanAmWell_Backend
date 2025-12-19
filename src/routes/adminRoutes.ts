// routes/adminRouter.ts - UPDATED WITH ADMIN-SPECIFIC MIDDLEWARE
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
    getCombinedGrowth 
} from "../controllers/adminController";
import { verifyAdminToken } from "../middleware/auth"; // ✅ Use verifyAdminToken

const adminRouter = express.Router();

// ==================== PUBLIC ROUTES ====================
adminRouter.post("/adminRegister", registerAdmin);
adminRouter.post("/adminLogin", loginAdmin);

// ==================== PROTECTED ROUTES ====================
// ✅ Use verifyAdminToken - it checks both authentication AND Admin role
adminRouter.get("/doctors", verifyAdminToken, getAllDoctorsAdmin);
adminRouter.get("/doctors/pending", verifyAdminToken, getPendingDoctorsAdmin);
adminRouter.get("/allAdmins", verifyAdminToken, getAllAdmins);
adminRouter.put("/doctors/:doctorId", verifyAdminToken, updateDoctorStatus);
adminRouter.get("/users", verifyAdminToken, getAllUsersAdmin);
adminRouter.get("/user/:userId", verifyAdminToken, getUserByIdAdmin);
adminRouter.get("/combinedGrowth", verifyAdminToken, getCombinedGrowth);

export default adminRouter;