import express from "express";
import {
  createAppointment,
  getMyAppointments,
  getDoctorAppointments,
  updateAppointment,
  getAllAppointments,
  deleteAppointment,
} from "../controllers/appointmentController";

import { guestAuth, verifyToken, authorize } from "../middleware/auth";

const appointmentRouter = express.Router();

// User: create appointment
appointmentRouter.post("/", guestAuth, createAppointment);

// User: get their own appointments
appointmentRouter.get("/my", guestAuth, verifyToken, getMyAppointments);

// Doctor: get their appointment calendar
appointmentRouter.get("/doctor", guestAuth, verifyToken, getDoctorAppointments);

// Admin: all appointments
appointmentRouter.get("/", authorize("Admin"), getAllAppointments);

// Update (user or doctor)
appointmentRouter.patch("/:id", guestAuth, authorize("User", "Doctor"), updateAppointment);

// Admin: delete
appointmentRouter.delete("/:id", authorize("Admin"), deleteAppointment);

export default appointmentRouter;
