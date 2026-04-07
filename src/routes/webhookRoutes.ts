// routes/webhook.routes.ts
import express from "express";
import { handlePaymentWebhook } from "../controllers/webhookController";

const webhookRouter = express.Router();

// Do NOT add auth middleware here
webhookRouter.post("/payment-status", handlePaymentWebhook);

export default webhookRouter;