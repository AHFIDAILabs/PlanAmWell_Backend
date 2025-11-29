// adminController.ts
import { Request, Response } from "express";
import { Doctor, IDoctor } from "../models/doctor";
import asyncHandler from "../middleware/asyncHandler";

/**
 * 🧑‍⚖️ ADMIN ONLY — Update a Doctor's status (Approval/Rejection)
 * This allows an admin to move a doctor from 'submitted' to 'approved' or 'rejected'.
 */
export const updateDoctorStatus = asyncHandler(async (req: Request, res: Response) => {
  const { status } = req.body;
  const doctorId = req.params.id;

  if (!status || !["submitted", "reviewing", "approved", "rejected"].includes(status)) {
    res.status(400);
    throw new Error("Invalid or missing 'status' field.");
  }

  const doctor: IDoctor | null = await Doctor.findById(doctorId);

  if (!doctor) {
    res.status(404);
    throw new Error("Doctor not found");
  }

  // Prevents the doctor from being downgraded from 'approved' without explicit admin intent
  if (doctor.status === "approved" && status !== "approved" && status !== "rejected") {
     res.status(400);
     throw new Error(`Cannot change status from 'approved' to '${status}'.`);
  }

  const updatedDoctor = await Doctor.findByIdAndUpdate(
    doctorId,
    { status: status },
    { new: true, runValidators: true }
  ).select("-passwordHash");

  res.status(200).json({
    success: true,
    data: updatedDoctor,
    message: `Doctor status updated to '${status}' successfully.`,
  });
});

/**
 * 🔎 ADMIN ONLY — Get all doctors (including unapproved)
 */
export const getAllDoctorsAdmin = asyncHandler(async (req: Request, res: Response) => {
  // Admin needs to see all statuses for review/management
  const doctors: IDoctor[] = await Doctor.find({}).select("-passwordHash");
  res.status(200).json({ success: true, data: doctors });
});