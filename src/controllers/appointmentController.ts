import { Request, Response } from "express";
import asyncHandler from "../middleware/asyncHandler";
import { Appointment, IAppointment } from "../models/appointment";
import { sendPushNotification } from "../util/sendPushNotification";
import { Doctor } from "../models/doctor";
import { User } from "../models/user";
import { createAppointmentNotification } from "../util/sendPushNotification";
import Notification from "../models/notifications";

/**
 * @desc Create Appointment (Users)
 * @route POST /api/v1/appointments
 * @access User
 */
export const createAppointment = asyncHandler(
  async (req: Request, res: Response) => {
    const { doctorId, scheduledAt, duration, notes, reason, shareUserInfo } =
      req.body;

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
        "name firstName lastName email phone gender dateOfBirth homeAddress"
      );

      if (user) {
        patientSnapshot = {
          name: user.name || "Anonymous",
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

// ✅ ADD THIS NOTIFICATION
if (req.auth?.id) {
  try {
    const doctorName = `${doctor.firstName} ${doctor.lastName}`;
    await createAppointmentNotification(
      req.auth.id,
      String(appointment._id),
      "confirmed", // You can change this to "placed" or create a new type
      doctorName,
      new Date(scheduledAt)
    );
  } catch (notifError) {
    console.error("[AppointmentController] Failed to send notification:", notifError);
    // Don't fail the appointment creation if notification fails
  }
}

res.status(201).json({
  success: true,
  data: appointment,
  message:
    "Appointment request sent successfully. Awaiting doctor review.",
});
  }
);

/**
 * @desc Get appointments for logged-in user
 * @route GET /api/v1/appointments/my
 * @access User
 */
export const getMyAppointments = asyncHandler(
  async (req: Request, res: Response) => {
    const appointments = await Appointment.find({ userId: req.auth?.id })
      .populate("doctorId")
      .sort({ scheduledAt: 1 });

    res.status(200).json({ success: true, data: appointments });
  }
);

/**
 * @desc Get all appointments for a doctor
 * @route GET /api/v1/appointments/doctor
 * @access Doctor
 */
export const getDoctorAppointments = asyncHandler(
  async (req: Request, res: Response) => {
    const doctorId = req.auth?.id;

    const appointments = await Appointment.find({ doctorId })
      .populate("userId")
      .sort({ scheduledAt: 1 });

    res.status(200).json({ success: true, data: appointments });
  }
);

/**
 * @desc Update appointment (Users can only modify their own, Doctors can confirm/cancel/reschedule)
 * @route PATCH /api/v1/appointments/:id
 * @access User | Doctor
 */


export const updateAppointment = asyncHandler(
  async (req: Request, res: Response) => {
    const appointment = await Appointment.findById(req.params.id).populate(
      "doctorId",
      "firstName lastName"
    );
    if (!appointment) {
      res.status(404);
      throw new Error("Appointment not found.");
    }

    const userId = req.auth?.id;
    const role = req.auth?.role;
console.log("AUTH USER:", userId);
console.log("AUTH ROLE:", role);
console.log("APPOINTMENT DOCTOR:", appointment.doctorId.toString());

    // Permission checks
    if (role === "User" && appointment.userId.toString() !== userId) {
      return res
        .status(403)
        .json({ message: "You can only update your own appointments." });
    }
    if (role === "Doctor" && appointment.doctorId.toString() !== userId) {
      return res.status(403).json({
        message: "You can only update appointments assigned to you.",
      });
    }

    const updates: Partial<IAppointment> = {};

    // User updates
    if (role === "User") {
      if (
        req.body.status === "cancelled" &&
        appointment.status === "pending"
      ) {
        updates.status = "cancelled";
      }
      if (req.body.scheduledAt) updates.scheduledAt = req.body.scheduledAt;
      if (req.body.notes) updates.notes = req.body.notes;
      if (typeof req.body.shareUserInfo === "boolean")
        updates.shareUserInfo = req.body.shareUserInfo;
      if (req.body.patientSnapshot)
        updates.patientSnapshot = req.body.patientSnapshot;
    }

    // Doctor updates
if (role === "Doctor") {
  const doctorId = appointment.doctorId;

  const doctorIdString =
    doctorId && typeof doctorId === "object" && "_id" in doctorId
      ? (doctorId as { _id: any })._id.toString()
      : doctorId;

  if (!doctorIdString || doctorIdString !== userId) {
    return res.status(403).json({
      message: "You can only update appointments assigned to you.",
    });
  }
}


    // Apply updates
    const updatedAppointment = (await Appointment.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    ).populate("doctorId", "firstName lastName")) as (IAppointment & {
      _id: string;
    }) | null;

    // ✨ Create notification in database + send push notification
    if (
      role === "Doctor" &&
      updatedAppointment?.status &&
      updatedAppointment.userId
    ) {
      const doctor = updatedAppointment.doctorId as any;
      const doctorName = `${doctor.firstName} ${doctor.lastName}`;

      // Map status to notification type
      const statusToNotificationType: Record<
        string,
        "confirmed" | "rejected" | "cancelled"
      > = {
        confirmed: "confirmed",
        rejected: "rejected",
        cancelled: "cancelled",
      };

      const notificationType = statusToNotificationType[updatedAppointment.status];

      if (notificationType) {
        try {
          await createAppointmentNotification(
            updatedAppointment.userId.toString(),
            updatedAppointment._id,
            notificationType,
            doctorName,
            updatedAppointment.scheduledAt
          );
        } catch (error) {
          console.error("❌ Failed to create notification:", error);
        }
      }
    }

    // ✨ Schedule automatic 15-minute reminder if appointment is confirmed
    if (
      updatedAppointment?.status === "confirmed" &&
      updatedAppointment.userId &&
      !updatedAppointment.reminderSent
    ) {
      const reminderTime =
        new Date(updatedAppointment.scheduledAt).getTime() - 15 * 60 * 1000;
      const delay = reminderTime - Date.now();

      if (delay > 0) {
        setTimeout(async () => {
          try {
            // Check if reminder already sent (in case of server restart)
            const appt = await Appointment.findById(updatedAppointment._id);
            if (appt && !appt.reminderSent) {
              const doctor = updatedAppointment.doctorId as any;
              const doctorName = `${doctor.firstName} ${doctor.lastName}`;

              await createAppointmentNotification(
                updatedAppointment.userId.toString(),
                String(updatedAppointment._id),
                "reminder",
                doctorName,
                updatedAppointment.scheduledAt
              );

              // Mark reminder as sent
              appt.reminderSent = true;
              await appt.save();
            }
          } catch (error) {
            console.error("❌ Failed to send reminder:", error);
          }
        }, delay);
      }
    }

    res.status(200).json({ success: true, data: updatedAppointment });
  }
);

/**
 * @desc Admin — get ALL appointments
 * @route GET /api/v1/appointments
 * @access Admin
 */
export const getAllAppointments = asyncHandler(
  async (req: Request, res: Response) => {
    const appointments = await Appointment.find()
      .populate("doctorId")
      .populate("userId")
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, data: appointments });
  }
);

/**
 * @desc Admin — Delete appointment
 * @route DELETE /api/v1/appointments/:id
 * @access Admin
 */
export const deleteAppointment = asyncHandler(
  async (req: Request, res: Response) => {
    if (req.auth?.role !== "Admin") {
      return res
        .status(403)
        .json({ message: "Only admin can delete appointments." });
    }

    const appointment = await Appointment.findByIdAndDelete(req.params.id);
    if (!appointment) {
      res.status(404);
      throw new Error("Appointment not found.");
    }

    res
      .status(200)
      .json({ success: true, message: "Appointment deleted successfully." });
  }
);

/**
 * ⏰ Cron job: Send appointment reminders (call this every 5 minutes)
 * @desc Send reminders for appointments starting in 15 minutes
 */
export const sendAppointmentReminders = async () => {
  try {
    const now = new Date();
    const reminderTime = new Date(now.getTime() + 15 * 60 * 1000); // 15 minutes from now

   const upcomingAppointments = (await Appointment.find({
  status: "confirmed",
  scheduledAt: {
    $gte: now,
    $lte: reminderTime,
  },
  reminderSent: { $ne: true },
}).populate("doctorId", "firstName lastName")) as (IAppointment & {
  _id: string;
})[];


    for (const appt of upcomingAppointments) {
      const doctor = appt.doctorId as any;
      const doctorName = `${doctor.firstName} ${doctor.lastName}`;

      await createAppointmentNotification(
        appt.userId.toString(),
        appt._id.toString(),
        "reminder",
        doctorName,
        appt.scheduledAt
      );

      // Mark reminder as sent
      appt.reminderSent = true;
      await appt.save();
    }

    console.log(`✅ Sent ${upcomingAppointments.length} appointment reminders`);
  } catch (error) {
    console.error("❌ Error sending reminders:", error);
  }
};