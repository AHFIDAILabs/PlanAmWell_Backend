// controllers/appointmentController.ts
import mongoose from "mongoose";
import { Request, Response } from "express";
import asyncHandler from "../middleware/asyncHandler";
import { Appointment, IAppointment } from "../models/appointment";
import { Doctor } from "../models/doctor";
import { User } from "../models/user";
import { NotificationService } from "../services/NotificationService";
import { createNotificationForUser } from "../util/sendPushNotification";
import { Conversation } from "../models/conversation";
import { emitAppointmentEnded, emitConversationUnlocked } from "../index";

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

    if (!doctorId || !scheduledAt) {
      res.status(400);
      throw new Error("doctorId and scheduledAt are required.");
    }

    const doctor = await Doctor.findById(doctorId);
    if (!doctor || doctor.status !== "approved") {
      res.status(404);
      throw new Error("Doctor not found or not approved.");
    }

    const user = await User.findById(req.auth?.id).select(
      "name email phone gender dateOfBirth homeAddress"
    );

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
      notificationsSent: {
        reminder: false,
        expiryWarning: false,
        callStarted: false,
        callEnded: false,
      },
    });

    const doctorName = `Dr. ${doctor.lastName || doctor.firstName}`;
    const patientName = user?.name || "A patient";

    try {
      await NotificationService.notifyAppointmentRequestSent(
        req.auth.id,
        String(appointment._id),
        doctorName,
        scheduledDate
      );
    } catch (error) {
      console.error("❌ Failed to send patient notification:", error);
    }

    try {
      await NotificationService.notifyDoctorNewRequest(
        String(doctorId),
        String(appointment._id),
        patientName,
        scheduledDate,
        reason
      );
    } catch (error) {
      console.error("❌ Failed to send doctor notification:", error);
    }

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

    if (!userId || !role) {
      res.status(401);
      throw new Error("Unauthorized");
    }

    if (role === "User" && appointment.userId.toString() !== userId) {
      return res
        .status(403)
        .json({ message: "You can only update your own appointments." });
    }

    if (role === "Doctor" && appointment.doctorId.toString() !== userId) {
      return res
        .status(403)
        .json({ message: "You can only update appointments assigned to you." });
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

    // ── USER updates ──────────────────────────────────────────────────────────
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
      if (typeof req.body.shareUserInfo === "boolean")
        updates.shareUserInfo = req.body.shareUserInfo;
      if (req.body.patientSnapshot)
        updates.patientSnapshot = req.body.patientSnapshot;
      if (req.body.consultationType)
        updates.consultationType = req.body.consultationType;
    }

    // ── DOCTOR updates ────────────────────────────────────────────────────────
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
        updates.scheduledAt = newDate;
        if (req.body.consultationType)
          updates.consultationType = req.body.consultationType;
        if (appointment.status !== "rescheduled") updates.status = "rescheduled";
      }
      if (req.body.notes) updates.notes = req.body.notes;
    }

    // ── Apply updates ─────────────────────────────────────────────────────────
    const updatedAppointment = (await Appointment.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    )
      .populate(
        "doctorId",
        "firstName lastName doctorImage email contactNumber licenseNumber"
      )
      .populate("userId", "name userImage email")) as any;

    if (!updatedAppointment) {
      res.status(404);
      throw new Error("Failed to update appointment.");
    }

    const patientId = extractId(updatedAppointment.userId);
    const doctorId = extractId(updatedAppointment.doctorId);
    const doctor = updatedAppointment.doctorId as any;
    const patient = updatedAppointment.userId as any;
    const doctorName = `Dr. ${doctor.lastName || doctor.firstName}`;
    const patientName = patient?.name || "Patient";

    // ── CONVERSATION: Auto-unlock on new appointment confirmation ─────────────
    //
    // RULES (never changes, preserved exactly):
    //  1. One conversation per doctor-patient pair — NEVER create a second one.
    //  2. When doctor confirms a new appointment → find the existing conversation
    //     and unlock it (isActive = true) + add a system message + link new appointment.
    //  3. If truly no conversation exists yet → create one fresh.
    //  4. isActive = false is set ONLY by endAppointment.
    //  5. isActive = true here (on confirm) OR via manual unlockConversation endpoint.
    //
    let conversationId: string | null = null;

    if (
      role === "Doctor" &&
      updates.status === "confirmed" &&
      oldStatus !== "confirmed"
    ) {
      try {
        // Look up by doctor-patient pair first — handles returning patients whose
        // conversation appointmentId still points to an older appointment.
        let conversation = await Conversation.findOne({
          "participants.userId": patientId,
          "participants.doctorId": doctorId,
        });

        if (conversation) {
          // ── RETURNING PATIENT: unlock the existing conversation ─────────────
          const wasLocked = !conversation.isActive;

          conversation.isActive = true; // ← THE unlock

          // Add a system message so both parties can see the new appointment
          conversation.messages.push({
            _id: new mongoose.Types.ObjectId(),
            senderId: new mongoose.Types.ObjectId(doctorId),
            senderType: "Doctor",
            messageType: "system",
            content: `New appointment confirmed for ${updatedAppointment.scheduledAt.toLocaleString()}. Chat is now active again.`,
            status: "sent",
            createdAt: new Date(),
          } as any);

          conversation.lastActivityAt = new Date();
          await conversation.save();

          // Always link the new appointment to this conversation so
          // getOrCreateConversation Step 1 (appointmentId lookup) works next time.
          updatedAppointment.conversationId = conversation._id;
          await updatedAppointment.save();

          conversationId = String(conversation._id);

          if (wasLocked) {
            // Emit real-time unlock event so both screens reflect the unlocked
            // state immediately without a manual refresh.
            emitConversationUnlocked(String(conversation._id), patientId);
            console.log(
              `🔓 Conversation ${conversationId} auto-unlocked for returning patient`
            );
          } else {
            console.log(
              `✅ Existing active conversation reused for returning patient`
            );
          }
        } else {
          // ── FIRST-TIME PATIENT: create a brand-new conversation ─────────────
          conversation = await Conversation.create({
            appointmentId: updatedAppointment._id,
            participants: {
              userId: patientId,
              doctorId: doctorId,
            },
            messages: [
              {
                _id: new mongoose.Types.ObjectId(),
                senderId: new mongoose.Types.ObjectId(doctorId),
                senderType: "Doctor",
                messageType: "system",
                content: `${doctorName} confirmed your appointment. You can now chat before your consultation on ${updatedAppointment.scheduledAt.toLocaleString()}.`,
                status: "sent",
                createdAt: new Date(),
              },
            ],
            isActive: true,
          });

          updatedAppointment.conversationId = conversation._id;
          await updatedAppointment.save();

          conversationId = String(conversation._id);
          console.log(`✅ New conversation created for first-time patient`);
        }
      } catch (err) {
        console.error("❌ Failed to create/unlock conversation:", err);
      }
    } else if (updatedAppointment.conversationId) {
      conversationId = String(updatedAppointment.conversationId);
    }

    // ── NOTIFICATIONS ─────────────────────────────────────────────────────────
    if (role === "Doctor" && updates.status && updates.status !== oldStatus) {
      try {
        switch (updates.status) {
          case "confirmed":
            await NotificationService.notifyAppointmentConfirmed(
              patientId,
              String(updatedAppointment._id),
              doctorName,
              updatedAppointment.scheduledAt,
              conversationId ?? undefined
            );

            // Auto-create access request for medical records
            try {
              const { AccessRequest } = await import("../models/AccessRequest");
              const existingRequest = await AccessRequest.findOne({
                appointmentId: updatedAppointment._id,
              });
              if (!existingRequest) {
                const newRequest = await AccessRequest.create({
                  patientId,
                  requestingDoctorId: doctorId,
                  appointmentId: updatedAppointment._id,
                  status: "pending",
                  requestedAt: new Date(),
                  expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
                });
                await NotificationService.notifyRecordAccessRequest(
                  patientId,
                  String(newRequest._id),
                  doctorName,
                  doctor.specialization || ""
                );
              }
            } catch (err) {
              console.error("❌ Access request error:", err);
            }
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
      } catch (error) {
        console.error("❌ Notification error:", error);
      }
    }

    if (role === "User" && updates.status === "cancelled") {
      try {
        await NotificationService.notifyAppointmentCancelledByPatient(
          doctorId,
          String(updatedAppointment._id),
          patientName,
          updatedAppointment.scheduledAt
        );
      } catch (error) {
        console.error("❌ Failed to notify doctor:", error);
      }
    }

    // ── REMINDER ──────────────────────────────────────────────────────────────
    if (
      updatedAppointment.status === "confirmed" &&
      !updatedAppointment.notificationsSent?.reminder &&
      oldStatus !== "confirmed"
    ) {
      const reminderTime =
        new Date(updatedAppointment.scheduledAt).getTime() - 15 * 60 * 1000;
      const delay = reminderTime - Date.now();

      if (delay > 0 && delay < 7 * 24 * 60 * 60 * 1000) {
        setTimeout(async () => {
          try {
            const appt = await Appointment.findById(updatedAppointment._id);
            if (
              appt &&
              !appt.notificationsSent?.reminder &&
              appt.status === "confirmed"
            ) {
              await NotificationService.notifyAppointmentReminder(
                patientId,
                "User",
                String(appt._id),
                doctorName,
                appt.scheduledAt
              );
              await NotificationService.notifyAppointmentReminder(
                doctorId,
                "Doctor",
                String(appt._id),
                patientName,
                appt.scheduledAt
              );
              await NotificationService.markNotificationSent(
                String(appt._id),
                "reminder"
              );
            }
          } catch (err) {
            console.error("❌ Reminder error:", err);
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
    res
      .status(200)
      .json({ success: true, message: "Appointment deleted successfully." });
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
      scheduledAt: { $gte: reminderTimeStart, $lt: reminderTimeEnd },
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

    return { success: true, count: sentCount };
  } catch (error) {
    console.error("❌ Error sending reminders:", error);
    return { success: false, error };
  }
};

/**
 * @desc  Doctor ends an appointment manually
 * @route PATCH /api/v1/appointments/:id/end
 * @access Doctor only
 *
 * WHAT THIS DOES:
 *  1. Marks appointment as completed.
 *  2. Locks the conversation (isActive = false) — makes chat read-only.
 *  3. Notifies both parties.
 *  4. Emits real-time appointment-ended event to both screens.
 *
 * WHAT IT DOES NOT DO:
 *  - It does NOT prompt, trigger, or have any awareness of note-writing.
 *    Notes are a completely independent action the doctor can take at any time
 *    via the note icon in the chat header.
 *  - It does NOT delete the conversation.
 *  - It does NOT prevent the doctor from manually unlocking later.
 *
 * The conversation stays read-only until:
 *   a) Doctor confirms a new appointment from same patient (auto-unlock via
 *      updateAppointment), OR
 *   b) Doctor manually unlocks via PATCH /chat/conversation/:id/unlock
 *
 * The "End" button on the frontend switches to an "Unlock" button after this
 * succeeds, driven purely by the isActive flag on the conversation.
 */
export const endAppointment = asyncHandler(
  async (req: Request, res: Response) => {
    const appointmentId = req.params.id;
    const doctorId = req.auth?.id;

    const appointment = await Appointment.findById(appointmentId)
      .populate("doctorId", "firstName lastName")
      .populate("userId", "name");

    if (!appointment) {
      res.status(404);
      throw new Error("Appointment not found.");
    }

    if (extractId(appointment.doctorId) !== doctorId) {
      return res.status(403).json({
        success: false,
        message: "You can only end your own appointments.",
      });
    }

    // Idempotent — already ended, return success without side-effects
    if (appointment.status === "completed") {
      return res.status(200).json({
        success: true,
        message: "Appointment already ended.",
        data: appointment,
      });
    }

    // ── 1. Mark appointment as completed ─────────────────────────────────────
    appointment.status = "completed";
    appointment.callStatus = "ended";
    appointment.callEndedAt = new Date();
    appointment.callEndedBy = "Doctor";
    await appointment.save();

    // ── 2. Lock the conversation ───────────────────────────────────────────────
    // Find by doctor-patient pair (more reliable than appointmentId alone since
    // the conversation may be linked to an older appointmentId after reactivations).
    const patientId = extractId(appointment.userId);

    const lockedConversation = await Conversation.findOneAndUpdate(
      {
        "participants.userId": patientId,
        "participants.doctorId": doctorId,
      },
      { isActive: false },
      { new: true }
    );

    if (lockedConversation) {
      console.log(
        `🔒 Conversation ${lockedConversation._id} locked after appointment ended`
      );
    }

    // ── 3. Notify both parties ─────────────────────────────────────────────────
    const doctor = appointment.doctorId as any;
    const patient = appointment.userId as any;
    const doctorName = `Dr. ${doctor.lastName || doctor.firstName}`;
    const patientName = patient?.name || "Patient";

    try {
      await NotificationService.notifyAppointmentEnded(
        patientId,
        "User",
        String(appointment._id),
        doctorName
      );
      await NotificationService.notifyAppointmentEnded(
        doctorId!,
        "Doctor",
        String(appointment._id),
        patientName
      );
    } catch (err) {
      console.error("❌ Failed to send appointment-ended notifications:", err);
    }

    // ── 4. Emit real-time event so both screens update immediately ────────────
    emitAppointmentEnded(String(appointment._id));

    res.status(200).json({
      success: true,
      message: "Appointment ended. Chat is now read-only.",
      data: appointment,
    });
  }
);