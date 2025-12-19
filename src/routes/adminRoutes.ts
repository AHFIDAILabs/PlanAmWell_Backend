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
} from "../controllers/adminController";
import { verifyToken, authorize } from "../middleware/auth";

const adminRouter = express.Router();

// ============================================================================
// PUBLIC ROUTES (No Authentication Required)
// ============================================================================

// Admin Registration & Login
adminRouter.post("/adminRegister", registerAdmin);
adminRouter.post("/adminLogin", loginAdmin);

// ============================================================================
// PROTECTED ADMIN ROUTES (Authentication + Admin Role Required)
// ============================================================================

// All routes below require: verifyToken + authorize("Admin")
// DO NOT use guestAuth on admin routes - admins must be authenticated!

// Get all doctors
adminRouter.get(
    "/doctors", 
    verifyToken, 
    authorize("Admin"), 
    getAllDoctorsAdmin
);

// Get pending doctors only
adminRouter.get(
    "/doctors/pending", 
    verifyToken, 
    authorize("Admin"), 
    getPendingDoctorsAdmin
);

// Get all admins
adminRouter.get(
    "/allAdmins", 
    verifyToken, 
    authorize("Admin"), 
    getAllAdmins
);

// Update doctor status
adminRouter.put(
    "/doctors/:doctorId", 
    verifyToken, 
    authorize("Admin"), 
    updateDoctorStatus
);

// Get all users
adminRouter.get(
    "/users", 
    verifyToken, 
    authorize("Admin"), 
    getAllUsersAdmin
);

// Get a single user by ID
adminRouter.get(
    "/user/:userId", 
    verifyToken, 
    authorize("Admin"), 
    getUserByIdAdmin
);

// Get growth analytics (users/doctors per week/month)
adminRouter.get(
    "/combinedGrowth", 
    verifyToken, 
    authorize("Admin"), 
    getCombinedGrowth
);

export default adminRouter;