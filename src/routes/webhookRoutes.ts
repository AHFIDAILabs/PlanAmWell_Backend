// routes/webhook.routes.ts
import express from "express";
import { handleDeliveryWebhook, handlePaymentWebhook } from "../controllers/webhookController";
import { handleAppointmentPaymentWebhook } from "../controllers/appointmentPaymentController";

const webhookRouter = express.Router();

// Do NOT add auth middleware here
webhookRouter.post("/payment-status", handlePaymentWebhook);

webhookRouter.post("/delivery-status", handleDeliveryWebhook);

// Consultation payment webhook — separate from the partner-routed
// payment-status webhook above, which is Order/pharmacy-shaped.
webhookRouter.post("/appointment-payment", handleAppointmentPaymentWebhook);

export default webhookRouter;