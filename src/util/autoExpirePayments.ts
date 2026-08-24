// util/autoExpirePayments.ts
//
// An appointment reserves its slot the instant it's created (the unique
// doctorId+scheduledAt index enforces that atomically), but only actually
// becomes a real request once payment succeeds. If someone abandons the
// payment browser and never comes back, this releases the slot instead of
// holding it forever.

import { Appointment } from "../models/appointment";

const PAYMENT_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

export const autoExpireAbandonedPayments = async () => {
  const cutoff = new Date(Date.now() - PAYMENT_WINDOW_MS);

  const result = await Appointment.updateMany(
    { status: "awaiting-payment", createdAt: { $lt: cutoff } },
    { $set: { status: "cancelled", paymentStatus: "failed" } }
  );

  if (result.modifiedCount > 0) {
    console.log(`[autoExpirePayments] Released ${result.modifiedCount} abandoned-payment slot(s).`);
  }
};
