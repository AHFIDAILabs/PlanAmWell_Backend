import cron from "node-cron";
import { Appointment } from "../models/appointment";
import { createNotificationForUser } from "../util/sendPushNotification";

cron.schedule("* * * * *", async () => {
  try {
    const now = new Date();
    const reminderTimeStart = new Date(now.getTime() + 15 * 60 * 1000);
    const reminderTimeEnd = new Date(reminderTimeStart.getTime() + 60 * 1000);

    const upcomingAppointments = await Appointment.find({
      status: "confirmed",
      scheduledAt: { $gte: reminderTimeStart, $lt: reminderTimeEnd },
      "notificationsSent.reminder": { $ne: true }, // ✅ Prevent duplicate reminders
    })
      .populate("doctorId", "firstName lastName")
      .populate("userId", "name firstName lastName");

    for (const appointment of upcomingAppointments) {
      if (!appointment.userId) continue;

      const doctor = appointment.doctorId as any;
      const patient = appointment.userId as any;
      const doctorName = `Dr. ${doctor?.lastName || doctor?.firstName || "Doctor"}`;
      const patientName = patient?.name || `${patient?.firstName || ""} ${patient?.lastName || ""}`.trim() || "Patient";

      try {
        // ✅ Notify patient
        await createNotificationForUser(
          appointment.userId.toString(),
          "User", // ✅ userType parameter
          "Appointment Reminder",
          `Your appointment with ${doctorName} starts in 15 minutes!`,
          "appointment",
          {
            appointmentId: (appointment._id as any).toString(),
            doctorId: appointment.doctorId?.toString(),
            doctorName,
            status: "reminder",
          }
        );

        // ✅ Notify doctor
        if (appointment.doctorId) {
          await createNotificationForUser(
            appointment.doctorId.toString(),
            "Doctor", // ✅ userType parameter
            "Appointment Reminder",
            `Your appointment with ${patientName} starts in 15 minutes!`,
            "appointment",
            {
              appointmentId: (appointment._id as any).toString(),
              userId: appointment.userId.toString(),
              patientName,
              status: "reminder",
            }
          );
        }

        // ✅ Mark reminder as sent
        if (!appointment.notificationsSent) {
          appointment.notificationsSent = {
            reminder: false,
            expiryWarning: false,
            callStarted: false,
            callEnded: false,
          };
        }
        appointment.notificationsSent.reminder = true;
        appointment.reminderSent = true; // Legacy field
        await appointment.save();

      } catch (notifError) {
        console.error(`[ReminderJob] Failed to send reminder for appointment ${appointment._id}:`, notifError);
      }
    }

    if (upcomingAppointments.length > 0) {
      console.log(`[ReminderJob] Sent ${upcomingAppointments.length * 2} reminders (${upcomingAppointments.length} appointments)`);
    }
  } catch (error) {
    console.error("[ReminderJob] Error:", error);
  }
});