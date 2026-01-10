// jobs/appointmentReminders.ts - UPGRADED WITH DEDUPLICATION
import cron from "node-cron";
import { Appointment } from "../models/appointment";
import { NotificationService } from "../services/NotificationService";

/**
 * ✅ CRON JOB: Send 15-minute appointment reminders
 * Runs every minute to check for upcoming appointments
 */
cron.schedule("* * * * *", async () => {
  try {
    const now = new Date();
    const reminderTimeStart = new Date(now.getTime() + 15 * 60 * 1000);
    const reminderTimeEnd = new Date(reminderTimeStart.getTime() + 60 * 1000);

    // ✅ CRITICAL: Only fetch appointments that haven't been reminded yet
    const upcomingAppointments = await Appointment.find({
      status: "confirmed",
      scheduledAt: { $gte: reminderTimeStart, $lt: reminderTimeEnd },
      "notificationsSent.reminder": { $ne: true }, // ✅ Prevent duplicates
    })
      .populate("doctorId", "firstName lastName")
      .populate("userId", "name firstName lastName");

    if (upcomingAppointments.length === 0) {
      // No appointments to remind - exit silently
      return;
    }

    // console.log(`⏰ [ReminderJob] Found ${upcomingAppointments.length} appointments needing reminders`);

    for (const appointment of upcomingAppointments) {
      if (!appointment.userId) {
        console.warn(`⚠️ [ReminderJob] Skipping appointment ${appointment._id} - missing userId`);
        continue;
      }

      const doctor = appointment.doctorId as any;
      const patient = appointment.userId as any;
      
      const doctorName = `Dr. ${doctor?.lastName || doctor?.firstName || "Doctor"}`;
      const patientName = patient?.name || 
                         `${patient?.firstName || ""} ${patient?.lastName || ""}`.trim() || 
                         "Patient";

      try {
        // ✅ Send reminder to PATIENT
        await NotificationService.notifyAppointmentReminder(
          appointment.userId.toString(),
          "User",
          (appointment._id as any).toString(),
          doctorName,
          appointment.scheduledAt
        );

        // ✅ Send reminder to DOCTOR
        if (appointment.doctorId) {
          await NotificationService.notifyAppointmentReminder(
            appointment.doctorId.toString(),
            "Doctor",
            (appointment._id as any).toString(),
            patientName,
            appointment.scheduledAt
          );
        }

        // ✅ CRITICAL: Mark reminder as sent (prevents duplicates)
        await NotificationService.markNotificationSent(
          (appointment._id as any).toString(),
          "reminder"
        );

        // console.log(`✅ [ReminderJob] Sent reminders for appointment ${appointment._id}`);
      } catch (notifError) {
        console.error(`❌ [ReminderJob] Failed to send reminder for appointment ${appointment._id}:`, notifError);
        // Continue to next appointment - don't let one failure stop the entire batch
      }
    }

    // console.log(`✅ [ReminderJob] Sent ${upcomingAppointments.length * 2} reminders (${upcomingAppointments.length} appointments)`);
  } catch (error) {
    console.error("❌ [ReminderJob] Error:", error);
  }
});

// console.log("✅ Appointment reminder cron job started (runs every minute)");