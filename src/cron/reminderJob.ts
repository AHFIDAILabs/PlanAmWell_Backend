// cron/reminderJob.ts - REMINDER + AUTO-EXPIRY
import cron from "node-cron";
import { Appointment } from "../models/appointment";
import { Conversation } from "../models/conversation";
import { NotificationService } from "../services/NotificationService";
import { emitAppointmentEnded } from "../index";
import { AccessRequest } from "../models/AccessRequest";
import { User } from "../models/user";

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

// Auto-deny access requests that have passed their 48h expiry
// Runs every 30 minutes — expiry is 48h so this is more than fine
cron.schedule("*\/30 * * * *", async () => {
  try {
    const now = new Date();
 
    const expired = await AccessRequest.find({
      status:    "pending",
      expiresAt: { $lt: now },
    });
 
    if (expired.length === 0) return;
 
    console.log(`⏰ [AccessRequestExpiry] Expiring ${expired.length} access requests`);
 
    for (const request of expired) {
      request.status      = "expired";
      request.respondedAt = now;
      await request.save();
 
      // Notify requesting doctor
      try {
        const patient = await User.findById(request.patientId).select("name");
        const patientName = patient?.name || "The patient";
 
        await NotificationService.create({
          userId:   String(request.requestingDoctorId),
          userType: "Doctor",
          title:    "Record Access Request Expired",
          message:  `Your request to access ${patientName}'s medical record has expired without a response.`,
          type:     "system",
          metadata: {
            patientId:      String(request.patientId),
            accessRequestId: String(request._id),
            type:           "record_access_response",
          },
        });
      } catch (err) {
        console.error(`❌ [AccessRequestExpiry] Notify failed for ${request._id}:`, err);
      }
    }
  } catch (error) {
    console.error("❌ [AccessRequestExpiry] Error:", error);
  }
});


// ── JOB: Remind users of pending payments every 4 hours ──────────────────────
cron.schedule("0 */4 * * *", async () => {
  try {
    const { Order } = await import("../models/order");
    const { NotificationService } = await import("../services/NotificationService");

    // Find orders pending payment for more than 30 minutes but less than 24 hours
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const pendingOrders = await Order.find({
      paymentStatus: "pending",
      partnerOrderId: { $exists: true }, // only confirmed orders awaiting payment
      createdAt: { $lt: thirtyMinutesAgo, $gt: twentyFourHoursAgo },
    });

    if (pendingOrders.length === 0) return;

    console.log(`💳 [PaymentReminderJob] Found ${pendingOrders.length} pending payment orders`);

    for (const order of pendingOrders) {
      if (!order.userId) continue;
      try {
        await NotificationService.notifyPaymentPending(
          order.userId.toString(),
          order._id.toString(),
          order.orderNumber,
          order.total,
        );
        console.log(`✅ [PaymentReminderJob] Reminded user ${order.userId} for order ${order._id}`);
      } catch (err) {
        console.error(`❌ [PaymentReminderJob] Failed for order ${order._id}:`, err);
      }
    }
  } catch (error) {
    console.error("❌ [PaymentReminderJob] Error:", error);
  }
});




console.log("✅ Appointment reminder + auto-expiry cron jobs started");

