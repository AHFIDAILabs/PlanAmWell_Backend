// cron/reminderJob.ts - REMINDER + AUTO-EXPIRY
import cron from "node-cron";
import { Appointment } from "../models/appointment";
import { Conversation } from "../models/conversation";
import { NotificationService } from "../services/NotificationService";
import { emitAppointmentEnded } from "../index";

// ─────────────────────────────────────────────────────────────────────────────
// JOB 1: 15-minute appointment reminders (unchanged, runs every minute)
// ─────────────────────────────────────────────────────────────────────────────
cron.schedule("* * * * *", async () => {
  try {
    const now = new Date();
    const reminderTimeStart = new Date(now.getTime() + 15 * 60 * 1000);
    const reminderTimeEnd   = new Date(reminderTimeStart.getTime() + 60 * 1000);

    const upcomingAppointments = await Appointment.find({
      status: "confirmed",
      scheduledAt: { $gte: reminderTimeStart, $lt: reminderTimeEnd },
      "notificationsSent.reminder": { $ne: true },
    })
      .populate("doctorId", "firstName lastName")
      .populate("userId", "name firstName lastName");

    if (upcomingAppointments.length === 0) return;

    for (const appointment of upcomingAppointments) {
      if (!appointment.userId) continue;

      const doctor    = appointment.doctorId as any;
      const patient   = appointment.userId as any;
      const doctorName  = `Dr. ${doctor?.lastName || doctor?.firstName || "Doctor"}`;
      const patientName = patient?.name ||
                          `${patient?.firstName || ""} ${patient?.lastName || ""}`.trim() ||
                          "Patient";

      try {
        await NotificationService.notifyAppointmentReminder(
          appointment.userId.toString(), "User",
          (appointment._id as any).toString(), doctorName, appointment.scheduledAt
        );

        if (appointment.doctorId) {
          await NotificationService.notifyAppointmentReminder(
            appointment.doctorId.toString(), "Doctor",
            (appointment._id as any).toString(), patientName, appointment.scheduledAt
          );
        }

        await NotificationService.markNotificationSent(
          (appointment._id as any).toString(), "reminder"
        );
      } catch (notifError) {
        console.error(`❌ [ReminderJob] Failed for appointment ${appointment._id}:`, notifError);
      }
    }
  } catch (error) {
    console.error("❌ [ReminderJob] Error:", error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// JOB 2: Auto-expire confirmed appointments 48 hours after scheduledAt
// Runs every 15 minutes — no need to run every minute for a 48h window
// ─────────────────────────────────────────────────────────────────────────────
cron.schedule("*/15 * * * *", async () => {
  try {
    const now = new Date();

    // An appointment expires 48 hours after its scheduled time.
    // We look for confirmed appointments whose scheduledAt is > 48h ago.
    const expiryThreshold = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    const expiredAppointments = await Appointment.find({
      status: { $in: ["confirmed", "in-progress"] },
      scheduledAt: { $lt: expiryThreshold },
    })
      .populate("doctorId", "firstName lastName")
      .populate("userId", "name firstName lastName");

    if (expiredAppointments.length === 0) return;

    console.log(`⏰ [ExpiryJob] Found ${expiredAppointments.length} appointments to expire`);

    for (const appointment of expiredAppointments) {
      try {
        const doctor    = appointment.doctorId as any;
        const patient   = appointment.userId as any;
        const doctorName  = `Dr. ${doctor?.lastName || doctor?.firstName || "Doctor"}`;
        const patientName = patient?.name ||
                            `${patient?.firstName || ""} ${patient?.lastName || ""}`.trim() ||
                            "Patient";

        const patientId = appointment.userId?.toString();
        const doctorId  = appointment.doctorId?.toString();

        // ── Mark appointment completed ──────────────────────────────────────
        appointment.status      = "completed";
        appointment.callStatus  = "ended";
        appointment.callEndedAt = now;
        appointment.callEndedBy = "system";
        await appointment.save();

        // ── Lock the conversation ───────────────────────────────────────────
        await Conversation.findOneAndUpdate(
          { appointmentId: appointment._id },
          { isActive: false }
        );

        // ── Notify both parties ─────────────────────────────────────────────
        if (patientId) {
          await NotificationService.notifyAppointmentExpired(
            patientId, "User", (appointment._id as any).toString(), doctorName
          );
        }
        if (doctorId) {
          await NotificationService.notifyAppointmentExpired(
            doctorId, "Doctor", (appointment._id as any).toString(), patientName
          );
        }

        // ── Emit real-time event so open chat screens lock immediately ──────
        emitAppointmentEnded((appointment._id as any).toString());

        console.log(`✅ [ExpiryJob] Expired appointment ${appointment._id}`);
      } catch (err) {
        console.error(`❌ [ExpiryJob] Failed for appointment ${appointment._id}:`, err);
      }
    }
  } catch (error) {
    console.error("❌ [ExpiryJob] Error:", error);
  }
});

console.log("✅ Appointment reminder + auto-expiry cron jobs started");