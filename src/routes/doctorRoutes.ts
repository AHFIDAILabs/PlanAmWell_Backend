import { Router } from "express";
import {
  getDoctors,
  getDoctor,
  getDoctorCategories,
  createDoctor,
  updateDoctor,
  getMyDoctorProfile,
  updateDoctorAvailability,
  deleteDoctor,
} from "../controllers/doctorController";
import { verifyToken, authorize, guestAuth } from "../middleware/auth";
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

doctorRouter.get("/profile", guestAuth, verifyToken, getMyDoctorProfile);

doctorRouter.put("/availability", guestAuth, verifyToken, authorize("Doctor"), updateDoctorAvailability);


// NOW the /:id routes
doctorRouter.get("/:id", guestAuth, verifyToken, authorize("User", "Doctor", "Admin"), getDoctor);
doctorRouter.put("/:id", guestAuth, verifyToken, authorize("Doctor", "Admin"), upload.single("doctorImage"), updateDoctor);
doctorRouter.delete("/:id", guestAuth, verifyToken, authorize("Admin"), deleteDoctor);



export default doctorRouter;
