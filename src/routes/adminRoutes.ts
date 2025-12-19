import express from "express";
import { getAllDoctorsAdmin, updateDoctorStatus, registerAdmin, loginAdmin, getAllAdmins, getPendingDoctorsAdmin, getAllUsersAdmin,
    getUserByIdAdmin, getCombinedGrowth,
 } from "../controllers/adminController";
import { verifyToken, authorize } from "../middleware/auth";

const adminRouter = express.Router();

// Admin Registration & Login
adminRouter.post("/adminRegister", registerAdmin);
adminRouter.post("/adminLogin", loginAdmin);

// Admin-only: Get all doctors
adminRouter.get("/doctors", verifyToken, authorize("Admin"), getAllDoctorsAdmin);
adminRouter.get("/doctors/pending", verifyToken, authorize("Admin"), getPendingDoctorsAdmin);


// Admin-only: Get all admins
adminRouter.get("/allAdmins",  verifyToken, authorize("Admin"), getAllAdmins);

// Admin-only: Update doctor status
adminRouter.put("/doctors/:doctorId",  verifyToken, authorize("Admin"), updateDoctorStatus);

// Admin-only: Get all users
adminRouter.get("/users", verifyToken, authorize("Admin"), getAllUsersAdmin);

// Admin-only: Get a single user
adminRouter.get("/user/:userId", verifyToken, authorize("Admin"), getUserByIdAdmin)

// Admin-only: Get number of users per week for the current month
adminRouter.get("/combinedGrowth",  verifyToken, authorize("Admin"), getCombinedGrowth)


export default adminRouter;
