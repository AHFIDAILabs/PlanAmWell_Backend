// controllers/appointmentController.ts - UPGRADED WITH NOTIFICATION SERVICE
import { Request, Response } from "express";
import asyncHandler from "../middleware/asyncHandler";
import { Appointment, IAppointment } from "../models/appointment";
import { Doctor } from "../models/doctor";
import { User } from "../models/user";
import { NotificationService } from "../services/NotificationService";
import { createNotificationForUser } from "../util/sendPushNotification";

const extractId = (field: any): string => {
  if (!field) return "";
  if (typeof field === "string") return field;
  if (typeof field === "object" && field._id) return String(field._id);
  return String(field);
};

/**
 * @desc Create Appointment (Users)
 * @route POST /api/v1/appointments
 * @access User
 */
export const createAppointment = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      doctorId,
      scheduledAt,
      duration,
      notes,
      reason,
      shareUserInfo,
      consultationType,
    } = req.body;

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📅 NEW APPOINTMENT REQUEST");
    console.log("Patient ID:", req.auth?.id);
    console.log("Doctor ID:", doctorId);
    console.log("Scheduled At:", scheduledAt);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

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

    console.log("✅ Doctor found:", {
      id: doctor._id,
      name: `${doctor.firstName} ${doctor.lastName}`,
      status: doctor.status,
    });

    // Get user info
    const user = await User.findById(req.auth?.id).select(
      "name email phone gender dateOfBirth homeAddress"
    );

    console.log("✅ Patient found:", {
      id: user?._id,
      name: user?.name,
    });

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

    const scheduledDate = new Date(scheduledAt);
    if (isNaN(scheduledDate.getTime())) {
      res.status(400);
      throw new Error("Invalid scheduledAt date.");
    }

    if (!req.auth?.id) {
      res.status(401);
      throw new Error("Unauthorized");
    }

    // ✅ Create appointment
    const appointment = await Appointment.create({
      userId: req.auth?.id,
      doctorId,
      scheduledAt,
      duration,
      notes,
      reason,
      shareUserInfo: !!shareUserInfo,
      patientSnapshot,
      consultationType,
      notificationsSent: {
        reminder: false,
        expiryWarning: false,
        callStarted: false,
        callEnded: false,
      },
    });

    console.log("✅ Appointment created:", appointment._id);

    const doctorName = `Dr. ${doctor.lastName || doctor.firstName}`;
    const patientName = user?.name || "A patient";

    // ✅ NOTIFICATION 1: Notify PATIENT (request sent)
    try {
      await NotificationService.notifyAppointmentRequestSent(
        req.auth.id,
        String(appointment._id),
        doctorName,
        scheduledDate
      );
      console.log("✅ Patient notification sent successfully");
    } catch (error) {
      console.error("❌ Failed to send patient notification:", error);
    }

    // ✅ NOTIFICATION 2: Notify DOCTOR (new request)
    try {
      await NotificationService.notifyDoctorNewRequest(
        String(doctorId),
        String(appointment._id),
        patientName,
        scheduledDate,
        reason
      );
      console.log("✅ Doctor notification sent successfully");
    } catch (error) {
      console.error("❌ Failed to send doctor notification:", error);
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    res.status(201).json({
      success: true,
      data: appointment,
      message: "Appointment request sent successfully. Awaiting doctor review.",
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

    console.log("🔍 Fetching appointments for doctor:", doctorId);

    const appointments = await Appointment.find({ doctorId })
      .populate("userId")
      .sort({ scheduledAt: 1 });

    console.log("✅ Found appointments:", appointments.length);

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

    if (!userId || !role) {
      res.status(401);
      throw new Error("Unauthorized");
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("🔍 APPOINTMENT UPDATE");
    console.log("User ID:", userId, "Role:", role);
    console.log("Appointment UserID:", appointment.userId.toString());
    console.log("Appointment DoctorID:", appointment.doctorId.toString());
    console.log("Requested Status:", req.body.status);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // Permission checks
    if (role === "User" && appointment.userId.toString() !== userId) {
      return res.status(403).json({ message: "You can only update your own appointments." });
    }

    if (role === "Doctor" && appointment.doctorId.toString() !== userId) {
      return res.status(403).json({ message: "You can only update appointments assigned to you." });
    }

    type AppointmentUpdatePayload = {
      status?: IAppointment["status"];
      scheduledAt?: Date;
      notes?: string;
      shareUserInfo?: boolean;
      patientSnapshot?: IAppointment["patientSnapshot"];
      consultationType?: IAppointment["consultationType"];
    };

    const updates: AppointmentUpdatePayload = {};
    const oldStatus = appointment.status;
    const oldScheduledAt = appointment.scheduledAt;

    // USER updates
    if (role === "User") {
      if (
        req.body.status === "cancelled" &&
        ["pending", "confirmed"].includes(appointment.status)
      ) {
        updates.status = "cancelled";
      }

      if (req.body.scheduledAt) {
        const newDate = new Date(req.body.scheduledAt);
        if (isNaN(newDate.getTime())) {
          return res.status(400).json({ message: "Invalid scheduledAt date." });
        }
        updates.scheduledAt = newDate;
      }

      if (req.body.notes) updates.notes = req.body.notes;
      if (typeof req.body.shareUserInfo === "boolean") updates.shareUserInfo = req.body.shareUserInfo;
      if (req.body.patientSnapshot) updates.patientSnapshot = req.body.patientSnapshot;
      if (req.body.consultationType) updates.consultationType = req.body.consultationType;
    }

    // DOCTOR updates
    if (role === "Doctor") {
      if (req.body.status) {
        const allowedDoctorStatuses: IAppointment["status"][] = [
          "confirmed",
          "rejected",
          "cancelled",
          "rescheduled",
        ];

        if (!allowedDoctorStatuses.includes(req.body.status)) {
          return res.status(400).json({ message: "Invalid status update." });
        }

        updates.status = req.body.status;
      }

      if (req.body.scheduledAt) {
        const newDate = new Date(req.body.scheduledAt);
        if (isNaN(newDate.getTime())) {
          return res.status(400).json({ message: "Invalid scheduledAt date." });
        }

        if (req.body.consultationType) updates.consultationType = req.body.consultationType;

        updates.scheduledAt = newDate;

        // If doctor changes time, mark as rescheduled
        if (appointment.status !== "rescheduled") {
          updates.status = "rescheduled";
        }
      }

      if (req.body.notes) updates.notes = req.body.notes;
    }

    console.log("📝 Applying updates:", updates);

    // Apply updates
    const updatedAppointment = (await Appointment.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    )
      .populate("doctorId", "firstName lastName doctorImage email contactNumber licenseNumber")
      .populate("userId", "name userImage email")) as any;

    if (!updatedAppointment) {
      res.status(404);
      throw new Error("Failed to update appointment.");
    }

    console.log("✅ Appointment updated successfully!");

    // Extract clean IDs
    const patientId = extractId(updatedAppointment.userId);
    const doctorId = extractId(updatedAppointment.doctorId);

    const doctor = updatedAppointment.doctorId as any;
    const patient = updatedAppointment.userId as any;

    const doctorName = `Dr. ${doctor.lastName || doctor.firstName}`;
    const patientName = patient?.name || "Patient";

    // ✅ NOTIFICATIONS: Doctor → Patient status changes
    if (role === "Doctor" && updates.status && updates.status !== oldStatus) {
      console.log(`📤 Sending status update notification to PATIENT: ${patientId}`);

      try {
        switch (updates.status) {
          case "confirmed":
            await NotificationService.notifyAppointmentConfirmed(
              patientId,
              String(updatedAppointment._id),
              doctorName,
              updatedAppointment.scheduledAt
            );
            break;

          case "rejected":
            await NotificationService.notifyAppointmentRejected(
              patientId,
              String(updatedAppointment._id),
              doctorName
            );
            break;

          case "cancelled":
            await NotificationService.notifyAppointmentCancelledByDoctor(
              patientId,
              String(updatedAppointment._id),
              doctorName,
              updatedAppointment.scheduledAt
            );
            break;

          case "rescheduled":
            await NotificationService.notifyAppointmentRescheduled(
              patientId,
              String(updatedAppointment._id),
              doctorName,
              updatedAppointment.scheduledAt
            );
            break;
        }

        console.log("✅ Patient notification sent successfully");
      } catch (error) {
        console.error("❌ Failed to send patient notification:", error);
      }
    }

    // ✅ NOTIFICATION: Patient cancels → Notify doctor
    if (role === "User" && updates.status === "cancelled") {
      console.log(`📤 Sending cancellation notification to DOCTOR: ${doctorId}`);

      try {
        await NotificationService.notifyAppointmentCancelledByPatient(
          doctorId,
          String(updatedAppointment._id),
          patientName,
          updatedAppointment.scheduledAt
        );
        console.log("✅ Doctor notification sent successfully");
      } catch (error) {
        console.error("❌ Failed to send doctor notification:", error);
      }
    }

    // ✅ SCHEDULE 15-MIN REMINDER (only on confirmation)
    if (
      updatedAppointment.status === "confirmed" &&
      !updatedAppointment.notificationsSent?.reminder &&
      oldStatus !== "confirmed"
    ) {
      const reminderTime = new Date(updatedAppointment.scheduledAt).getTime() - 15 * 60 * 1000;
      const delay = reminderTime - Date.now();

      console.log(`⏰ Scheduling 15-min reminder in ${Math.floor(delay / 60000)} minutes`);

      if (delay > 0 && delay < 7 * 24 * 60 * 60 * 1000) {
        setTimeout(async () => {
          try {
            const appt = await Appointment.findById(updatedAppointment._id);
            if (appt && !appt.notificationsSent?.reminder && appt.status === "confirmed") {
              // Send to patient
              await NotificationService.notifyAppointmentReminder(
                patientId,
                "User",
                String(appt._id),
                doctorName,
                appt.scheduledAt
              );

              // Send to doctor
              await NotificationService.notifyAppointmentReminder(
                doctorId,
                "Doctor",
                String(appt._id),
                patientName,
                appt.scheduledAt
              );

              // Mark as sent
              await NotificationService.markNotificationSent(String(appt._id), "reminder");

              console.log(`✅ Sent 15-min reminder for appointment ${appt._id}`);
            }
          } catch (err) {
            console.error("❌ Failed to send reminder:", err);
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
 * @desc User/Doctor — Get appointment by ID
 * @route GET /api/v1/appointments/:id
 * @access User | Doctor
 */
export const getAppointmentById = asyncHandler(
  async (req: Request, res: Response) => {
    const appointment = await Appointment.findById(req.params.id)
      .populate("doctorId", "firstName lastName")
      .populate("userId", "firstName lastName name email userImage");

    if (!appointment) {
      res.status(404);
      throw new Error("Appointment not found.");
    }

    const userId = req.auth?.id;
    const role = req.auth?.role;

    if (role === "User" && (appointment.userId as any)._id.toString() !== userId) {
      return res.status(403).json({ message: "You can only access your own appointments." });
    }

    if (role === "Doctor" && (appointment.doctorId as any)._id.toString() !== userId) {
      return res.status(403).json({ message: "You can only access your assigned appointments." });
    }

    res.status(200).json({ success: true, data: appointment });
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
      return res.status(403).json({ message: "Only admin can delete appointments." });
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
    const reminderTimeStart = new Date(now.getTime() + 15 * 60 * 1000);
    const reminderTimeEnd = new Date(reminderTimeStart.getTime() + 60 * 1000);

    const upcomingAppointments = (await Appointment.find({
      status: "confirmed",
      scheduledAt: {
        $gte: reminderTimeStart,
        $lt: reminderTimeEnd,
      },
      "notificationsSent.reminder": { $ne: true },
    })
      .populate("doctorId", "firstName lastName")
      .populate("userId", "name firstName lastName")) as (IAppointment & {
      _id: string;
    })[];

    let sentCount = 0;

    for (const appt of upcomingAppointments) {
      const doctor = appt.doctorId as any;
      const patient = appt.userId as any;
      const doctorName = `Dr. ${doctor.lastName || doctor.firstName}`;
      const patientName =
        patient?.name ||
        `${patient?.firstName || ""} ${patient?.lastName || ""}`.trim();

      try {
        await Promise.all([
          createNotificationForUser(
            String(appt.userId),
            "User",
            "Appointment Starting Soon ⏰",
            `Your appointment with ${doctorName} starts in 15 minutes!`,
            "appointment",
            {
              appointmentId: String(appt._id),
              doctorId: String(appt.doctorId),
              doctorName,
              scheduledAt: appt.scheduledAt.toISOString(),
              type: "reminder",
            }
          ),

          createNotificationForUser(
            String(appt.doctorId),
            "Doctor",
            "Appointment Starting Soon ⏰",
            `Your appointment with ${patientName} starts in 15 minutes!`,
            "appointment",
            {
              appointmentId: String(appt._id),
              userId: String(appt.userId),
              patientName,
              scheduledAt: appt.scheduledAt.toISOString(),
              type: "reminder",
            }
          ),
        ]);

        if (!appt.notificationsSent) {
          appt.notificationsSent = {
            reminder: false,
            expiryWarning: false,
            callStarted: false,
            callEnded: false,
          };
        }
        appt.notificationsSent.reminder = true;
        appt.reminderSent = true;
        await appt.save();

        sentCount++;
      } catch (err) {
        console.error(`❌ Failed to send reminder for ${appt._id}:`, err);
      }
    }

    if (sentCount > 0) {
      console.log(`✅ Sent ${sentCount * 2} appointment reminders`);
    }

    return { success: true, count: sentCount };
  } catch (error) {
    console.error("❌ Error sending reminders:", error);
    return { success: false, error };
  }
};