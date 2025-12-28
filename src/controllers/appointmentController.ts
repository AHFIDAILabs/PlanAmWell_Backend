// controllers/appointmentController.ts - Enhanced with debugging
import { Request, Response } from "express";
import asyncHandler from "../middleware/asyncHandler";
import { Appointment, IAppointment } from "../models/appointment";
import { Doctor } from "../models/doctor";
import { User } from "../models/user";
import { createNotificationForUser } from "../util/sendPushNotification";

const extractId = (field: any): string => {
  if (!field) return "";
  if (typeof field === "string") return field;
  if (typeof field === "object" && field._id) {
    return String(field._id);
  }
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
      status: doctor.status
    });

    // Get user info
    const user = await User.findById(req.auth?.id).select(
      "name firstName lastName email phone gender dateOfBirth homeAddress"
    );

    console.log("✅ Patient found:", {
      id: user?._id,
      name: user?.name || `${user?.name}`
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
    });

    console.log("✅ Appointment created:", appointment._id);

    const doctorName = `Dr. ${doctor.lastName || doctor.firstName}`;
    const patientName = user?.name || "A patient";

    // 🔔 Notify PATIENT: Request sent
    console.log("📤 Sending notification to PATIENT:", req.auth.id);
    try {
      await createNotificationForUser(
        req.auth.id,
        "User",
        "Appointment Request Sent",
        `Your appointment request with ${doctorName} for ${new Date(
          scheduledAt
        ).toLocaleString()} has been sent. Awaiting confirmation.`,
        "appointment",
        {
          appointmentId: String(appointment._id),
          doctorId,
          doctorName,
          scheduledAt,
          status: "pending",
        }
      );
      console.log("✅ Patient notification sent successfully");
    } catch (error) {
      console.error("❌ Failed to send patient notification:", error);
    }

    // 🔔 Notify DOCTOR: New request
    console.log("📤 Sending notification to DOCTOR:", doctorId);
    console.log("Doctor ID type:", typeof doctorId);
    console.log("Doctor ID value:", doctorId);
    
    try {
      const doctorIdString = String(doctorId);
      console.log("Using doctor ID string:", doctorIdString);
      
      await createNotificationForUser(
        doctorIdString,
        "Doctor",
        "New Appointment Request",
        `${patientName} has requested an appointment for ${new Date(
          scheduledAt
        ).toLocaleString()}${reason ? ` - ${reason}` : ""}`,
        "appointment",
        {
          appointmentId: String(appointment._id),
          userId: req.auth?.id,
          patientName,
          scheduledAt,
          reason,
          status: "pending",
        }
      );
      console.log("✅ Doctor notification sent successfully");
    } catch (error) {
      console.error("❌ Failed to send doctor notification:", error);
      console.error("Error details:", error);
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

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
      return res
        .status(403)
        .json({ message: "You can only update your own appointments." });
    }

    if (role === "Doctor" && appointment.doctorId.toString() !== userId) {
      return res.status(403).json({
        message: "You can only update appointments assigned to you.",
      });
    }

    // Safe update payload
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

      if (typeof req.body.shareUserInfo === "boolean") {
        updates.shareUserInfo = req.body.shareUserInfo;
      }

      if (req.body.patientSnapshot) {
        updates.patientSnapshot = req.body.patientSnapshot;
      }

      if (req.body.consultationType) {
        updates.consultationType = req.body.consultationType;
      }
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

        if (req.body.consultationType)
          updates.consultationType = req.body.consultationType;

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

    console.log(`📧 Clean IDs - Patient: ${patientId}, Doctor: ${doctorId}`);

    const doctor = updatedAppointment.doctorId as any;
    const patient = updatedAppointment.userId as any;

    const doctorName = `Dr. ${doctor.lastName || doctor.firstName}`;
    const patientName = patient?.name || "Patient";

    // ✅ Doctor → Patient notifications (prevent duplicates)
    if (role === "Doctor" && updates.status && updates.status !== oldStatus) {
      console.log(`📤 Sending status update notification to PATIENT: ${patientId}`);
      console.log(`Status changed from ${oldStatus} to ${updates.status}`);
      
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
          message: `${doctorName} declined your appointment request.`,
        },
        cancelled: {
          title: "Appointment Cancelled",
          message: `${doctorName} cancelled your appointment scheduled for ${new Date(
            updatedAppointment.scheduledAt
          ).toLocaleString()}`,
        },
        rescheduled: {
          title: "Appointment Rescheduled",
          message: `${doctorName} rescheduled your appointment to ${new Date(
            updatedAppointment.scheduledAt
          ).toLocaleString()}`,
        },
      };

      const notification = statusMessages[updates.status];
      if (notification) {
        try {
          await createNotificationForUser(
            patientId,
            "User",
            notification.title,
            notification.message,
            "appointment",
            {
              appointmentId: String(updatedAppointment._id),
              doctorId,
              doctorName,
              scheduledAt: updatedAppointment.scheduledAt.toISOString(),
              status: updates.status,
            }
          );
          console.log("✅ Patient notification sent successfully");
        } catch (error) {
          console.error("❌ Failed to send patient notification:", error);
        }
      }
    }

    // ✅ Patient cancels → Doctor notifications
    if (role === "User" && updates.status === "cancelled") {
      console.log(`📤 Sending cancellation notification to DOCTOR: ${doctorId}`);
      
      try {
        await createNotificationForUser(
          doctorId,
          "Doctor",
          "Appointment Cancelled by Patient",
          `${patientName} cancelled the appointment scheduled for ${new Date(
            updatedAppointment.scheduledAt
          ).toLocaleString()}`,
          "appointment",
          {
            appointmentId: String(updatedAppointment._id),
            userId: patientId,
            patientName,
            scheduledAt: updatedAppointment.scheduledAt.toISOString(),
            status: "cancelled",
          }
        );
        console.log("✅ Doctor notification sent successfully");
      } catch (error) {
        console.error("❌ Failed to send doctor notification:", error);
      }
    }

    // ✅ IMPROVED: 15-minute reminder scheduling (prevent duplicates)
    if (
      updatedAppointment.status === "confirmed" &&
      !updatedAppointment.notificationsSent?.reminder &&
      oldStatus !== "confirmed"
    ) {
      const reminderTime =
        new Date(updatedAppointment.scheduledAt).getTime() - 15 * 60 * 1000;
      const delay = reminderTime - Date.now();

      console.log(`⏰ Scheduling 15-min reminder in ${Math.floor(delay / 60000)} minutes`);

      if (delay > 0 && delay < 7 * 24 * 60 * 60 * 1000) {
        setTimeout(async () => {
          try {
            const appt = await Appointment.findById(updatedAppointment._id);
            if (
              appt &&
              !appt.notificationsSent?.reminder &&
              appt.status === "confirmed"
            ) {
              const apptPatientId = extractId(appt.userId);
              const apptDoctorId = extractId(appt.doctorId);

              console.log("⏰ Sending 15-min reminders...");

              await Promise.all([
                // Notify patient
                createNotificationForUser(
                  apptPatientId,
                  "User",
                  "Appointment Starting Soon ⏰",
                  `Your appointment with ${doctorName} starts in 15 minutes!`,
                  "appointment",
                  {
                    appointmentId: String(appt._id),
                    doctorId: apptDoctorId,
                    doctorName,
                    scheduledAt: appt.scheduledAt.toISOString(),
                    type: "reminder",
                  }
                ),

                // Notify doctor
                createNotificationForUser(
                  apptDoctorId,
                  "Doctor",
                  "Appointment Starting Soon ⏰",
                  `Your appointment with ${patientName} starts in 15 minutes!`,
                  "appointment",
                  {
                    appointmentId: String(appt._id),
                    userId: apptPatientId,
                    patientName,
                    scheduledAt: appt.scheduledAt.toISOString(),
                    type: "reminder",
                  }
                ),
              ]);

              // ✅ Mark reminder as sent
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

    // Optional: Authorization check
    const userId = req.auth?.id;
    const role = req.auth?.role;

    if (
      role === "User" &&
      (appointment.userId as any)._id.toString() !== userId
    ) {
      return res
        .status(403)
        .json({ message: "You can only access your own appointments." });
    }

    if (
      role === "Doctor" &&
      (appointment.doctorId as any)._id.toString() !== userId
    ) {
      return res
        .status(403)
        .json({ message: "You can only access your assigned appointments." });
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