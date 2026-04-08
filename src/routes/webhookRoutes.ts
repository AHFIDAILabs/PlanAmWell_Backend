// routes/webhook.routes.ts
import express from "express";
import { handleDeliveryWebhook, handlePaymentWebhook } from "../controllers/webhookController";

const webhookRouter = express.Router();

// Do NOT add auth middleware here
webhookRouter.post("/payment-status", handlePaymentWebhook);

webhookRouter.post("/delivery-status", handleDeliveryWebhook);

export default webhookRouter;