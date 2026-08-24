// controllers/appointmentPaymentController.ts
//
// Payment for a booked consultation — distinct from paymentController.ts,
// which is Order/pharmacy-shaped (partner-routed). This is Appointment-
// shaped and talks directly to whichever PaymentProvider is configured.
import crypto from "crypto";
import { Request, Response } from "express";
import asyncHandler from "../middleware/asyncHandler";
import { Appointment } from "../models/appointment";
import { Doctor } from "../models/doctor";
import { User } from "../models/user";
import { NotificationService } from "../services/NotificationService";
import { getPaymentProvider } from "../services/paymentProviders";

/**
 * @desc Start payment for a reserved (awaiting-payment) appointment
 * @route POST /api/v1/appointments/:id/payment/initiate
 * @access User
 */
export const initiateAppointmentPayment = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { redirectUrl } = req.body as { redirectUrl?: string };
  const userId = req.auth?.id;

  // The client supplies where the payment browser should return to once
  // payment completes — a deep link for mobile (planamwell://...), a page
  // URL for web. The backend doesn't hardcode one, since it differs per app.
  if (!redirectUrl) {
    res.status(400);
    throw new Error("redirectUrl is required.");
  }

  const appointment = await Appointment.findById(id);
  if (!appointment) {
    res.status(404);
    throw new Error("Appointment not found.");
  }
  if (String(appointment.userId) !== userId) {
    res.status(403);
    throw new Error("Not your appointment.");
  }
  if (appointment.status !== "awaiting-payment") {
    return res.status(400).json({
      success: false,
      message: `This appointment is not awaiting payment (status: ${appointment.status}).`,
    });
  }
  if (!appointment.amountKobo) {
    res.status(500);
    throw new Error("Appointment has no amount set.");
  }

  const user = await User.findById(userId).select("email");
  if (!user?.email) {
    res.status(400);
    throw new Error("An email address is required to initiate payment.");
  }

  const reference = `appt_${appointment._id}_${crypto.randomBytes(6).toString("hex")}`;

  const provider = getPaymentProvider();
  const { authorizationUrl } = await provider.initialize({
    amountKobo: appointment.amountKobo,
    email: user.email,
    reference,
    callbackUrl: redirectUrl,
  });

  appointment.paymentReference = reference;
  appointment.paymentProvider = provider.name;
  await appointment.save();

  res.status(200).json({ success: true, data: { authorizationUrl, reference } });
});

/**
 * @desc Poll payment status right after returning from the payment browser —
 *       reads whatever the webhook already set, not a verification path itself.
 * @route GET /api/v1/appointments/:id/payment/status
 * @access User
 */
export const getAppointmentPaymentStatus = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = req.auth?.id;

  const appointment = await Appointment.findById(id).select("userId status paymentStatus");
  if (!appointment) {
    res.status(404);
    throw new Error("Appointment not found.");
  }
  if (String(appointment.userId) !== userId) {
    res.status(403);
    throw new Error("Not your appointment.");
  }

  res.status(200).json({
    success: true,
    data: { status: appointment.status, paymentStatus: appointment.paymentStatus },
  });
});

/**
 * @desc Payment provider webhook — the real source of truth for whether a
 *       consultation payment succeeded. No auth middleware; the provider's
 *       signature (verified per-provider inside PaymentProvider) is the gate.
 * @route POST /api/v1/webhooks/appointment-payment
 * @access Public (signature-verified)
 */
export const handleAppointmentPaymentWebhook = asyncHandler(async (req: Request, res: Response) => {
  const rawBody: Buffer = (req as any).rawBody ?? Buffer.from(JSON.stringify(req.body));
  const provider = getPaymentProvider();

  if (!provider.verifyWebhookSignature(rawBody, req.headers as Record<string, string>)) {
    return res.status(401).json({ success: false, message: "Invalid webhook signature" });
  }

  const event = provider.parseWebhookEvent(rawBody);
  if (!event) {
    // Not an event this integration handles — ack anyway so the provider
    // doesn't retry indefinitely.
    return res.status(200).json({ received: true });
  }

  const appointment = await Appointment.findOne({ paymentReference: event.reference });
  if (!appointment) {
    console.warn(`[AppointmentPaymentWebhook] No appointment for reference ${event.reference}`);
    return res.status(200).json({ received: true });
  }

  // Idempotent — a provider may retry the same webhook delivery.
  if (appointment.paymentStatus === "paid") {
    return res.status(200).json({ received: true });
  }

  if (event.status === "success") {
    appointment.paymentStatus = "paid";
    appointment.status = "pending";
    await appointment.save();

    try {
      const doctor = await Doctor.findById(appointment.doctorId).select("firstName lastName");
      const patient = await User.findById(appointment.userId).select("name");
      const doctorName = doctor ? `Dr. ${doctor.lastName || doctor.firstName}` : "the doctor";
      const patientName = patient?.name || "A patient";

      await NotificationService.notifyAppointmentRequestSent(
        String(appointment.userId),
        String(appointment._id),
        doctorName,
        appointment.scheduledAt
      );
      await NotificationService.notifyDoctorNewRequest(
        String(appointment.doctorId),
        String(appointment._id),
        patientName,
        appointment.scheduledAt,
        appointment.reason
      );
    } catch (error) {
      console.error("❌ Failed to send post-payment notifications:", error);
    }
  } else {
    appointment.paymentStatus = "failed";
    await appointment.save();
  }

  res.status(200).json({ received: true });
});
