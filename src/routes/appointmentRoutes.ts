import express from "express";
import {
  createAppointment,
  getMyAppointments,
  getDoctorAppointments,
  updateAppointment,
  getAllAppointments,
  deleteAppointment,
  getAppointmentById,
} from "../controllers/appointmentController";

import { guestAuth, verifyToken, authorize, verifyAdminToken } from "../middleware/auth";

const appointmentRouter = express.Router();

// Public routes (allow guest booking)
appointmentRouter.post("/", guestAuth, createAppointment);

// Protected routes (require auth) - use verifyToken consistently
appointmentRouter.get("/my", verifyToken, authorize("User"), getMyAppointments);
appointmentRouter.get("/appointment/:id", verifyToken, getAppointmentById);
appointmentRouter.get("/doctor", verifyToken, authorize("Doctor"), getDoctorAppointments);
appointmentRouter.patch("/:id", verifyToken, authorize("User", "Doctor"), updateAppointment);
appointmentRouter.get("/", verifyAdminToken, authorize("Admin"), getAllAppointments);
appointmentRouter.delete("/:id", verifyAdminToken, authorize("Admin"), deleteAppointment);

export default appointmentRouter;