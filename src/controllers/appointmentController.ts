import { Request, Response } from "express";
import asyncHandler from "../middleware/asyncHandler";
import { Appointment, IAppointment } from "../models/appointment";
import { Doctor } from "../models/doctor";
import mongoose from "mongoose";

/**
 * @desc Create Appointment (Users)
 * @route POST /api/v1/appointments
 * @access User
 */
export const createAppointment = asyncHandler(async (req: Request, res: Response) => {
  const { doctorId, scheduledAt, duration, notes } = req.body;

  if (!doctorId || !scheduledAt) {
    res.status(400);
    throw new Error("doctorId and scheduledAt are required.");
  }

  // Validate doctor exists + approved
  const doctor = await Doctor.findById(doctorId);
  if (!doctor || doctor.status !== "approved") {
    res.status(404);
    throw new Error("Doctor not found or not approved.");
  }

  const appointment = await Appointment.create({
    userId: req.auth?.id, // authenticated user
    doctorId,
    scheduledAt,
    duration,
    notes,
  });

  res.status(201).json({
    success: true,
    data: appointment,
    message: "Appointment request sent successfully.",
  });
});

/**
 * @desc Get appointments for logged-in user
 * @route GET /api/v1/appointments/my
 * @access User
 */
export const getMyAppointments = asyncHandler(async (req: Request, res: Response) => {
  const appointments = await Appointment.find({ userId: req.auth?.id })
    .populate("doctorId")
    .sort({ scheduledAt: 1 });

  res.status(200).json({ success: true, data: appointments });
});

/**
 * @desc Get all appointments for a doctor
 * @route GET /api/v1/appointments/doctor
 * @access Doctor
 */
export const getDoctorAppointments = asyncHandler(async (req: Request, res: Response) => {
  const doctorId = req.auth?.id;

  const appointments = await Appointment.find({ doctorId })
    .populate("userId")
    .sort({ scheduledAt: 1 });

  res.status(200).json({ success: true, data: appointments });
});

/**
 * @desc Update appointment (Users can only modify their own, Doctors can confirm/cancel)
 * @route PATCH /api/v1/appointments/:id
 * @access User | Doctor
 */
export const updateAppointment = asyncHandler(async (req: Request, res: Response) => {
  const appointment = await Appointment.findById(req.params.id);
  if (!appointment) {
    res.status(404);
    throw new Error("Appointment not found.");
  }

  const userId = req.auth?.id;
  const role = req.auth?.role;

  // Users can only update their own appointments
  if (role === "User" && appointment.userId.toString() !== userId) {
    return res.status(403).json({ message: "You can only update your own appointments." });
  }

  // Doctors can only update appointments assigned to them
  if (role === "Doctor" && appointment.doctorId.toString() !== userId) {
    return res.status(403).json({ message: "You can only update your own appointments." });
  }

  // Apply updates
  const allowedUpdates = ["scheduledAt", "status", "notes", "paymentStatus"];
  const updates: any = {};

  for (let key of allowedUpdates) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  const updatedAppointment = await Appointment.findByIdAndUpdate(
    req.params.id,
    updates,
    { new: true, runValidators: true }
  );

  res.status(200).json({ success: true, data: updatedAppointment });
});

/**
 * @desc Admin — get ALL appointments
 * @route GET /api/v1/appointments
 * @access Admin
 */
export const getAllAppointments = asyncHandler(async (req: Request, res: Response) => {
  const appointments = await Appointment.find()
    .populate("doctorId")
    .populate("userId")
    .sort({ createdAt: -1 });

  res.status(200).json({ success: true, data: appointments });
});

/**
 * @desc Admin — Delete appointment
 * @route DELETE /api/v1/appointments/:id
 * @access Admin
 */
export const deleteAppointment = asyncHandler(async (req: Request, res: Response) => {
  if (req.auth?.role !== "Admin") {
    return res.status(403).json({ message: "Only admin can delete appointments." });
  }

  const appointment = await Appointment.findByIdAndDelete(req.params.id);
  if (!appointment) {
    res.status(404);
    throw new Error("Appointment not found.");
  }

  res.status(200).json({ success: true, message: "Appointment deleted successfully." });
});
