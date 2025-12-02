import { Router } from "express";
import {
  getDoctors,
  getDoctor,
  getDoctorCategories,
  createDoctor,
  updateDoctor,
  deleteDoctor,
} from "../controllers/doctorController";
import { verifyToken, authorize } from "../middleware/auth";
import multer from "multer";
const storage = multer.memoryStorage();

const fileFilter = (req: any, file: any, cb: any) => {
  // Accept images only
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Only image files are allowed!"), false);
  }
};
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});


const doctorRouter = Router();

/**
 * PUBLIC — doctor self-registration
 * Status defaults to 'submitted'
 */
doctorRouter.post("/", upload.single("doctorImage"), createDoctor);

/**
 * PUBLIC — get all approved doctors
 */
doctorRouter.get("/", getDoctors);

doctorRouter.get("/doctorCategories", getDoctorCategories )

/**
 * ANY AUTH USER — get specific doctor profile
 * Admin can access any status; others only 'approved'
 */
doctorRouter.get("/:id", verifyToken, authorize("User", "Doctor", "Admin"), getDoctor);

/**
 * DOCTOR — update own profile (except status)
 * ADMIN — can update any field including status
 */
doctorRouter.put(
  "/:id",
  verifyToken,
  authorize("Doctor", "Admin"),
  upload.single("doctorImage"), 
  updateDoctor
);

/**
 * ADMIN ONLY — delete doctor
 */
doctorRouter.delete("/:id", verifyToken, authorize("Admin"), deleteDoctor);

export default doctorRouter;
