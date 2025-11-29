import { Request, Response } from "express";
import { Appointment } from "../models/appointment";
import asyncHandler from "../middleware/asyncHandler";

// GET all appointments
export const getAppointments = asyncHandler(async (req: Request, res: Response) => {
  const appointments = await Appointment.find();
  res.status(200).json({ success: true, data: appointments });
});

// GET single appointment
export const getAppointment = asyncHandler(async (req: Request, res: Response) => {
  const appointment = await Appointment.findById(req.params.id);
  if (!appointment) {
    res.status(404);
    throw new Error("Appointment not found");
  }
  res.status(200).json({ success: true, data: appointment });
});

// CREATE appointment
export const createAppointment = asyncHandler(async (req: Request, res: Response) => {
  const newAppointment = await Appointment.create(req.body);
  res.status(201).json({ success: true, data: newAppointment });
});

// UPDATE appointment
export const updateAppointment = asyncHandler(async (req: Request, res: Response) => {
  const appointment = await Appointment.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!appointment) {
    res.status(404);
    throw new Error("Appointment not found");
  }
  res.status(200).json({ success: true, data: appointment });
});

// DELETE appointment
export const deleteAppointment = asyncHandler(async (req: Request, res: Response) => {
  const appointment = await Appointment.findByIdAndDelete(req.params.id);
  if (!appointment) {
    res.status(404);
    throw new Error("Appointment not found");
  }
  res.status(200).json({ success: true, message: "Appointment deleted successfully" });
});
