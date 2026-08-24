// routes/appointmentRoutes.ts
import express from "express";
import rateLimit from "express-rate-limit";
import {
  createAppointment,
  getMyAppointments,
  getDoctorAppointments,
  updateAppointment,
  getAllAppointments,
  deleteAppointment,
  getAppointmentById,
  endAppointment,
  profileCheck,
  getBookedSlots,
} from "../controllers/appointmentController";

import {
  guestAuth,
  verifyToken,
  authorize,
  verifyAdminToken,
} from "../middleware/auth";
import { keyByUserOrIp } from "../middleware/rateLimit";

const appointmentRouter = express.Router();

// Generous enough for legitimate multi-booking (family members, rescheduling
// attempts) while still catching spam-booking; keyed by account, placed
// after guestAuth so req.auth is already populated.
const createAppointmentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUserOrIp,
  message: { success: false, message: "Too many booking attempts. Please try again later." },
});

// Public routes (allow guest booking)
appointmentRouter.post("/", guestAuth, createAppointmentLimiter, createAppointment);
appointmentRouter.get("/booked-slots", getBookedSlots);

// Protected routes
appointmentRouter.get("/profile-check", verifyToken, authorize("User"), profileCheck);
appointmentRouter.get("/my", verifyToken, authorize("User"), getMyAppointments);
appointmentRouter.get("/appointment/:id", verifyToken, getAppointmentById);
appointmentRouter.get(
  "/doctor",
  verifyToken,
  authorize("Doctor"),
  getDoctorAppointments,
);
appointmentRouter.patch(
  "/:id",
  verifyToken,
  authorize("User", "Doctor"),
  updateAppointment,
);
appointmentRouter.patch(
  "/:id/end",
  verifyToken,
  authorize("Doctor"),
  endAppointment,
); // ← NEW
appointmentRouter.get(
  "/",
  verifyAdminToken,
  authorize("Admin"),
  getAllAppointments,
);
appointmentRouter.delete(
  "/:id",
  verifyAdminToken,
  authorize("Admin"),
  deleteAppointment,
);

export default appointmentRouter;
