import cron from "node-cron";
import { Appointment } from "../models/appointment";
import { sendPushNotification } from "../util/sendPushNotification";

// Run every minute
cron.schedule("* * * * *", async () => {
  try {
    const now = new Date();
    const reminderTimeStart = new Date(now.getTime() + 15 * 60 * 1000); // 15 mins ahead
    const reminderTimeEnd = new Date(reminderTimeStart.getTime() + 60 * 1000); // 1 min window

    // Find confirmed appointments starting in 15 minutes
    const upcomingAppointments = await Appointment.find({
      status: "confirmed",
      scheduledAt: { $gte: reminderTimeStart, $lt: reminderTimeEnd },
    });

    for (const appointment of upcomingAppointments) {
      if (appointment.userId) {
        await sendPushNotification(appointment.userId.toString(), {
          title: "Appointment Reminder",
          message: `Your appointment with Dr. starts in 15 minutes!`,
          data: { appointmentId: appointment._id, status: "reminder" },
        } as any);
      }
    }

    if (upcomingAppointments.length > 0) {
      console.log(`[ReminderJob] Sent ${upcomingAppointments.length} reminders`);
    }
  } catch (error) {
    console.error("[ReminderJob] Error sending appointment reminders:", error);
  }
});
