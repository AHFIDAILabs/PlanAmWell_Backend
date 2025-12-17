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
    });

    for (const appointment of upcomingAppointments) {
      if (!appointment.userId) continue;

      await createNotificationForUser(
        appointment.userId.toString(),
        "Appointment Reminder",
        "Your appointment starts in 15 minutes!",
        "appointment",
        {
          appointmentId: (appointment._id as any).toString(),
          status: "reminder",
        }
      );
    }

    if (upcomingAppointments.length > 0) {
      console.log(`[ReminderJob] Sent ${upcomingAppointments.length} reminders`);
    }
  } catch (error) {
    console.error("[ReminderJob] Error:", error);
  }
});
