import { Request, Response } from "express";
import asyncHandler from "../middleware/asyncHandler";
import { Appointment, IAppointment } from "../models/appointment";
import { Doctor } from "../models/doctor";
import { User } from "../models/user";

/**
 * @desc Create Appointment (Users)
 * @route POST /api/v1/appointments
 * @access User
 */
export const createAppointment = asyncHandler(async (req: Request, res: Response) => {
  const {
    doctorId,
    scheduledAt,
    duration,
    notes,
    reason,
    shareUserInfo,
  } = req.body;

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

  // Get user info if share toggle is ON
  let patientSnapshot = null;

  if (shareUserInfo) {
    const user = await User.findById(req.auth?.id).select(
      "name firstName lastName email phone gender dateOfBirth"
    );

    if (user) {
      patientSnapshot = {
        name: user.name,
        email: user.email,
        phone: user.phone,
        gender: user.gender,
        dateOfBirth: user.dateOfBirth,
        homeAddress: user.homeAddress,
      };
    }
  }

  const appointment = await Appointment.create({
    userId: req.auth?.id,
    doctorId,
    scheduledAt,
    duration,
    notes,
    reason,
    shareUserInfo: !!shareUserInfo,
    patientSnapshot,
  });

  res.status(201).json({
    success: true,
    data: appointment,
    message: "Appointment request sent successfully. Awaiting doctor review.",
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
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('[Backend] 🔍 getDoctorAppointments called');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const doctorId = req.auth?.id;
  
  console.log('[Backend] Auth object:', req.auth);
  console.log('[Backend] Doctor ID from auth:', doctorId);
  console.log('[Backend] Doctor ID type:', typeof doctorId);
  
  // Check total appointments in DB
  const totalCount = await Appointment.countDocuments({});
  console.log('[Backend] 📊 Total appointments in DB:', totalCount);
  
  // Check appointments for this specific doctor
  const appointments = await Appointment.find({ doctorId })
    .populate("userId")
    .sort({ scheduledAt: 1 });
  
  console.log('[Backend] 📋 Appointments found for this doctor:', appointments.length);
  
  // If no appointments found, debug further
  if (appointments.length === 0 && totalCount > 0) {
    console.log('[Backend] ⚠️ No appointments for this doctor, but DB has appointments');
    
    // Get all unique doctorIds in the database
    const allAppointments = await Appointment.find({}).select('doctorId').lean();
    const uniqueDoctorIds = [...new Set(allAppointments.map(a => a.doctorId.toString()))];
    
    console.log('[Backend] 🔑 Unique doctor IDs in appointments:', uniqueDoctorIds);
    console.log('[Backend] 🔑 Looking for doctor ID:', doctorId);
    console.log('[Backend] 🔑 Doctor ID as string:', doctorId?.toString());
console.log('[Backend] ❓ ID exists in DB?:', doctorId ? uniqueDoctorIds.includes(doctorId.toString()) : false);  }
  
  if (appointments.length > 0) {
    console.log('[Backend] ✅ Sample appointment:', JSON.stringify(appointments[0], null, 2));
  }
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

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

  // Check permissions
  if (role === "User" && appointment.userId.toString() !== userId) {
    return res.status(403).json({ message: "You can only update your own appointments." });
  }

  if (role === "Doctor" && appointment.doctorId.toString() !== userId) {
    return res.status(403).json({ message: "You can only update appointments assigned to you." });
  }

  const updates: any = {};

  // Fields users can update
  if (role === "User") {
    if (req.body.status === "cancelled" && appointment.status === "pending") {
      updates.status = "cancelled";
    }
    if (req.body.scheduledAt) updates.scheduledAt = req.body.scheduledAt;
    if (req.body.notes) updates.notes = req.body.notes;
    if (typeof req.body.shareUserInfo === "boolean") updates.shareUserInfo = req.body.shareUserInfo;
    if (req.body.patientSnapshot) updates.patientSnapshot = req.body.patientSnapshot;
  }

  // Fields doctors can update
  if (role === "Doctor") {
    if (req.body.status) {
      const allowedDoctorStatuses = ["confirmed", "rejected", "rescheduled", "completed"];
      if (!allowedDoctorStatuses.includes(req.body.status)) {
        return res.status(400).json({ message: "Invalid status update for doctor." });
      }

      updates.status = req.body.status;

      // If rescheduling, doctor should provide proposedAt
      if (req.body.status === "rescheduled") {
        if (!req.body.proposedAt) {
          return res.status(400).json({ message: "proposedAt date is required when rescheduling." });
        }
        updates.proposedAt = req.body.proposedAt;
      }
    }

    if (req.body.notes) updates.notes = req.body.notes;
    if (req.body.duration) updates.duration = req.body.duration;
  }

  // Apply updates
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
