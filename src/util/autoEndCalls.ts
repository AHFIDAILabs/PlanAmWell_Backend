// utils/autoEndExpiredCalls.ts
//
// DESIGN RULE (matches videoCallController):
//   This util only manages CALL state (callStatus).
//   It never sets appointment.status = 'completed'.
//   Only the doctor's explicit "End Appointment" action completes an appointment.
//
// What this does:
//   1. Resets "zombie" ringing calls — calls stuck in 'ringing' for > 5 min
//      (both parties left without properly disconnecting)
//   2. Ends 'in-progress' calls that have exceeded the appointment duration
//      + 48-hour hard cap, but leaves the appointment open for the doctor
//   3. Sends expiry warnings at the 10-min mark

import { Appointment } from "../models/appointment";
import { NotificationService } from "../services/NotificationService";

const ZOMBIE_RINGING_MINUTES = 5; // reset stuck 'ringing' calls after 5 min
const HARD_CAP_HOURS = 48; // force-end call after 48h regardless

const extractId = (field: any): string => {
  if (!field) return "";
  if (typeof field === "string") return field;
  if (typeof field === "object" && field._id) return String(field._id);
  return String(field);
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. Reset zombie ringing calls
//    If a call has been in 'ringing' for > 5 min nobody answered — reset it
//    back to 'idle' so participants can try again.
// ─────────────────────────────────────────────────────────────────────────────

export const resetZombieRingingCalls = async () => {
  try {
    const cutoff = new Date(Date.now() - ZOMBIE_RINGING_MINUTES * 60 * 1000);

    const result = await Appointment.updateMany(
      {
        callStatus: "ringing",
        updatedAt: { $lt: cutoff },
      },
      {
        $set: {
          callStatus: "idle",
          callParticipants: [],
          callInitiatedBy: null,
        },
      },
    );

    if (result.modifiedCount > 0) {
      console.log(
        `🔄 [ZombieReset] Reset ${result.modifiedCount} stuck ringing calls to idle`,
      );
    }

    return { success: true, reset: result.modifiedCount };
  } catch (error) {
    console.error("❌ [ZombieReset] Error:", error);
    return { success: false, error };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. Force-end calls at the 48-hour hard cap
//    Ends the CALL only — appointment.status is never touched.
//    Doctor still needs to click "End Appointment".
// ─────────────────────────────────────────────────────────────────────────────

export const autoEndExpiredCalls = async () => {
  try {
    const now = new Date();
    const hardCap = new Date(now.getTime() - HARD_CAP_HOURS * 60 * 60 * 1000);

    const expiredCalls = await Appointment.find({
      callStatus: { $in: ["ringing", "in-progress"] },
      scheduledAt: { $lt: hardCap },
      status: { $ne: "completed" }, // skip already-completed appointments
    })
      .populate("doctorId", "firstName lastName")
      .populate("userId", "name");

    let endedCount = 0;

    for (const appointment of expiredCalls) {
      const doctorId = extractId(appointment.doctorId);
      const patientId = extractId(appointment.userId);
      const apptId = String(appointment._id);

      const callStart = appointment.callStartedAt || appointment.scheduledAt;
      const callDuration = Math.floor(
        (now.getTime() - new Date(callStart).getTime()) / 1000,
      );

      // ── End call only — appointment stays open ─────────────────────────────
      appointment.callStatus = "ended";
      appointment.callEndedAt = now;
      appointment.callEndedBy = "system" as any;
      appointment.callDuration = callDuration;
      // ✅ appointment.status intentionally NOT changed

      await appointment.save();

      try {
        await NotificationService.notifyCallAutoEnded(
          doctorId,
          "Doctor",
          apptId,
          callDuration,
        );
        await NotificationService.notifyCallAutoEnded(
          patientId,
          "User",
          apptId,
          callDuration,
        );
      } catch (notifError) {
        console.error(`[AutoEnd] Failed to notify for ${apptId}:`, notifError);
      }

      endedCount++;
      console.log(
        `⏰ [AutoEnd] Force-ended call for appointment ${apptId} after ${HARD_CAP_HOURS}h — appointment still open`,
      );
    }

    if (endedCount > 0) {
      console.log(`✅ [AutoEnd] Force-ended ${endedCount} calls at 48h cap`);
    } else {
      console.log(`✓ [AutoEnd] No calls exceeded ${HARD_CAP_HOURS}h cap`);
    }

    return { success: true, endedCount };
  } catch (error) {
    console.error("[AutoEnd] Error:", error);
    return { success: false, error };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. Send expiry warnings (10 min before scheduled end)
//    Warns both parties that the call time is nearly up.
//    Does NOT end anything.
// ─────────────────────────────────────────────────────────────────────────────

export const sendCallExpiryWarnings = async () => {
  try {
    const now = new Date();

    const activeCalls = await Appointment.find({
      callStatus: "in-progress",
      "notificationsSent.expiryWarning": { $ne: true },
    })
      .populate("doctorId", "firstName lastName")
      .populate("userId", "name");

    let warningCount = 0;

    for (const appointment of activeCalls) {
      const scheduledEnd = new Date(
        new Date(appointment.scheduledAt).getTime() +
          (appointment.duration || 30) * 60 * 1000,
      );

      const minutesUntilEnd = Math.floor(
        (scheduledEnd.getTime() - now.getTime()) / (1000 * 60),
      );

      if (minutesUntilEnd > 0 && minutesUntilEnd <= 10) {
        const doctorId = extractId(appointment.doctorId);
        const patientId = extractId(appointment.userId);
        const apptId = String(appointment._id);

        try {
          await NotificationService.notifyCallExpiryWarning(
            doctorId,
            "Doctor",
            apptId,
            minutesUntilEnd,
          );
          await NotificationService.notifyCallExpiryWarning(
            patientId,
            "User",
            apptId,
            minutesUntilEnd,
          );
          await NotificationService.markNotificationSent(
            apptId,
            "expiryWarning",
          );
          warningCount++;
        } catch (notifError) {
          console.error(`[ExpiryWarning] Failed for ${apptId}:`, notifError);
        }
      }
    }

    if (warningCount > 0) {
      console.log(`[ExpiryWarning] Sent ${warningCount} expiry warnings`);
    }

    return { success: true, warningCount };
  } catch (error) {
    console.error("[ExpiryWarning] Error:", error);
    return { success: false, error };
  }
};
