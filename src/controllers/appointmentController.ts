import { Request, Response } from "express";
import asyncHandler from "../middleware/asyncHandler";
import { Appointment, IAppointment } from "../models/appointment";
import { Doctor } from "../models/doctor";
import { User } from "../models/user";
import { createNotificationForUser } from "../util/sendPushNotification"; // 👈 Imported

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

    // Get user info
    const user = await User.findById(req.auth?.id).select(
      "name firstName lastName email phone gender dateOfBirth homeAddress"
    );

    // Get patient snapshot if share toggle is ON
    let patientSnapshot = null;
    if (shareUserInfo && user) {
      patientSnapshot = {
        name: user.name || "Anonymous",
        email: user.email,
        phone: user.phone,
        gender: user.gender,
        dateOfBirth: user.dateOfBirth,
        homeAddress: user.homeAddress,
      };
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

    const doctorName = `Dr. ${doctor.lastName || doctor.firstName}`;
    const patientName = user?.name || "A patient";

    // 🔔 Notify PATIENT: Request sent
    if (req.auth?.id) {
      await createNotificationForUser(
        req.auth.id,
        "Appointment Request Sent",
        `Your appointment request with ${doctorName} for ${new Date(
          scheduledAt
        ).toLocaleString()} has been sent. Awaiting confirmation.`,
        "appointment",
        {
          appointmentId: appointment._id,
          doctorId,
          doctorName,
          scheduledAt,
          status: "pending",
        }
      );
    }

    // 🔔 Notify DOCTOR: New request
    await createNotificationForUser(
      doctorId,
      "New Appointment Request",
      `${patientName} has requested an appointment for ${new Date(
        scheduledAt
      ).toLocaleString()}${reason ? ` - ${reason}` : ""}`,
      "appointment",
      {
        appointmentId: appointment._id,
        userId: req.auth?.id,
        patientName,
        scheduledAt,
        reason,
        status: "pending",
      }
    );

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
 * @desc Update appointment
 * @route PATCH /api/v1/appointments/:id
 * @access User | Doctor
 */
export const updateAppointment = asyncHandler(
  async (req: Request, res: Response) => {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) {
      res.status(404);
      throw new Error("Appointment not found.");
    }

    const userId = req.auth?.id;
    const role = req.auth?.role;

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("🔍 APPOINTMENT UPDATE");
    console.log("User ID:", userId, "Role:", role);
    console.log("Appointment UserID:", appointment.userId?.toString());
    console.log("Appointment DoctorID:", appointment.doctorId?.toString());
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // Permission checks
    if (role === "User" && appointment.userId?.toString() !== userId) {
      return res
        .status(403)
        .json({ message: "You can only update your own appointments." });
    }

    if (role === "Doctor" && appointment.doctorId?.toString() !== userId) {
      return res.status(403).json({
        message: "You can only update appointments assigned to you.",
      });
    }

    const updates: Partial<IAppointment> = {};
    const oldStatus = appointment.status;

    // User updates
    if (role === "User") {
      // ✅ FIX APPLIED: Allow cancellation of both 'pending' and 'confirmed' appointments
      if (
        req.body.status === "cancelled" &&
        ["pending", "confirmed"].includes(appointment.status)
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
      if (req.body.status) updates.status = req.body.status;
      if (req.body.notes) updates.notes = req.body.notes;
      if (req.body.scheduledAt) updates.scheduledAt = req.body.scheduledAt;
    }

    console.log("📝 Applying updates:", updates);

    // Apply updates
    const updatedAppointment = (await Appointment.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    )
      .populate("doctorId", "firstName lastName")
      .populate("userId", "name firstName lastName")) as (IAppointment & {
      _id: string;
    }) | null;

    if (!updatedAppointment) {
      res.status(404);
      throw new Error("Failed to update appointment.");
    }

    console.log("✅ Appointment updated successfully!");

    // Get names for notifications
    const doctor = updatedAppointment.doctorId as any;
    const patient = updatedAppointment.userId as any;
    const doctorName = `Dr. ${doctor.lastName || doctor.firstName}`;
    const patientName =
      patient?.name ||
      `${patient?.firstName || ""} ${patient?.lastName || ""}`.trim() ||
      "Patient";

    // 🔔 DOCTOR UPDATES → Notify Patient
    if (
      role === "Doctor" &&
      updates.status &&
      updates.status !== oldStatus
    ) {
      const statusMessages: Record<
        string,
        { title: string; message: string }
      > = {
        confirmed: {
          title: "Appointment Confirmed ✅",
          message: `${doctorName} has confirmed your appointment for ${new Date(
            updatedAppointment.scheduledAt
          ).toLocaleString()}`,
        },
        rejected: {
          title: "Appointment Declined",
          message: `${doctorName} declined your appointment request. Please choose another time.`,
        },
        cancelled: {
          title: "Appointment Cancelled",
          message: `${doctorName} cancelled your appointment scheduled for ${new Date(
            updatedAppointment.scheduledAt
          ).toLocaleString()}`,
        },
        rescheduled: {
          title: "Appointment Rescheduled",
          message: `${doctorName} has rescheduled your appointment to ${new Date(
            updatedAppointment.scheduledAt
          ).toLocaleString()}`,
        },
      };

      const notification = statusMessages[updates.status];
      if (notification) {
        await createNotificationForUser(
          updatedAppointment.userId.toString(),
          notification.title,
          notification.message,
          "appointment",
          {
            appointmentId: updatedAppointment._id,
            doctorId: doctor._id,
            doctorName,
            scheduledAt: updatedAppointment.scheduledAt,
            status: updates.status,
          }
        );
      }
    }

    // 🔔 PATIENT CANCELS → Notify Doctor
    if (role === "User" && updates.status === "cancelled") {
      await createNotificationForUser(
        updatedAppointment.doctorId.toString(),
        "Appointment Cancelled by Patient",
        `${patientName} has cancelled their appointment scheduled for ${new Date(
          updatedAppointment.scheduledAt
        ).toLocaleString()}`,
        "appointment",
        {
          appointmentId: updatedAppointment._id,
          userId: patient._id,
          patientName,
          scheduledAt: updatedAppointment.scheduledAt,
          status: "cancelled",
        }
      );
    }

    // ⏰ Schedule 15-minute reminder when confirmed
    if (
      updatedAppointment?.status === "confirmed" &&
      !updatedAppointment.reminderSent &&
      oldStatus !== "confirmed"
    ) {
      const reminderTime =
        new Date(updatedAppointment.scheduledAt).getTime() -
        15 * 60 * 1000;
      const delay = reminderTime - Date.now();

      if (delay > 0) {
        setTimeout(async () => {
          try {
            const appt = await Appointment.findById(updatedAppointment._id);
            if (appt && !appt.reminderSent && appt.status === "confirmed") {
              // Notify PATIENT
              await createNotificationForUser(
                appt.userId.toString(),
                "Appointment Starting Soon ⏰",
                `Your appointment with ${doctorName} starts in 15 minutes!`,
                "appointment",
                {
                  appointmentId: appt._id,
                  doctorId: appt.doctorId,
                  doctorName,
                  scheduledAt: appt.scheduledAt,
                  type: "reminder",
                }
              );

              // Notify DOCTOR
              await createNotificationForUser(
                appt.doctorId.toString(),
                "Appointment Starting Soon ⏰",
                `Your appointment with ${patientName} starts in 15 minutes!`,
                "appointment",
                {
                  appointmentId: appt._id,
                  userId: appt.userId,
                  patientName,
                  scheduledAt: appt.scheduledAt,
                  type: "reminder",
                }
              );

              appt.reminderSent = true;
              await appt.save();
            }
          } catch (error) {
            console.error("❌ Failed to send reminder:", error);
          }
        }, delay);
      }
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

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

    res.status(200).json({
      success: true,
      message: "Appointment deleted successfully.",
    });
  }
);

/**
 * ⏰ Cron job: Send appointment reminders
 */
export const sendAppointmentReminders = async () => {
  try {
    const now = new Date();
    const reminderTime = new Date(now.getTime() + 15 * 60 * 1000);

    const upcomingAppointments = (await Appointment.find({
      status: "confirmed",
      scheduledAt: {
        $gte: now,
        $lte: reminderTime,
      },
      reminderSent: { $ne: true },
    })
      .populate("doctorId", "firstName lastName")
      .populate("userId", "name firstName lastName")) as (IAppointment & {
      _id: string;
    })[];

    for (const appt of upcomingAppointments) {
      const doctor = appt.doctorId as any;
      const patient = appt.userId as any;
      const doctorName = `Dr. ${doctor.lastName || doctor.firstName}`;
      const patientName =
        patient?.name ||
        `${patient?.firstName || ""} ${patient?.lastName || ""}`.trim();

      // Notify PATIENT
      await createNotificationForUser(
        appt.userId.toString(),
        "Appointment Starting Soon ⏰",
        `Your appointment with ${doctorName} starts in 15 minutes!`,
        "appointment",
        {
          appointmentId: appt._id,
          doctorId: appt.doctorId,
          doctorName,
          scheduledAt: appt.scheduledAt,
          type: "reminder",
        }
      );

      // Notify DOCTOR
      await createNotificationForUser(
        appt.doctorId.toString(),
        "Appointment Starting Soon ⏰",
        `Your appointment with ${patientName} starts in 15 minutes!`,
        "appointment",
        {
          appointmentId: appt._id,
          userId: appt.userId,
          patientName,
          scheduledAt: appt.scheduledAt,
          type: "reminder",
        }
      );

      appt.reminderSent = true;
      await appt.save();
    }

    console.log(
      `✅ Sent ${upcomingAppointments.length * 2} appointment reminders`
    );
  } catch (error) {
    console.error("❌ Error sending reminders:", error);
  }
};