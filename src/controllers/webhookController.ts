import { Request, Response } from "express";
import asyncHandler from "../middleware/asyncHandler";
import { Payment } from "../models/initiatedPayment";
import { Order } from "../models/order";
import { createHmac, timingSafeEqual } from "crypto";

const PARTNER_API_KEY= process.env.PARTNER_API_KEY;
if (!PARTNER_API_KEY) {
  console.warn("[Webhook] WARNING: PARTNER_API_KEY is not set. Webhook endpoints are unauthenticated.");
}

const VALID_DELIVERY_STATUSES = ["pending", "processing", "shipped", "delivered", "cancelled", "failed"];

function verifyWebhookSecret(req: Request): boolean {
  if (!PARTNER_API_KEY) return true; // unconfigured — warn at startup, allow through
  const provided = (req.headers["x-webhook-secret"] as string) || (req.headers["authorization"] as string)?.replace("Bearer ", "");
  if (!provided) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(PARTNER_API_KEY));
  } catch {
    return false;
  }
}

/**
 * ✅ Partner Webhook: Payment Status Update
 * Payload:
 * {
 *   paymentId: string;
 *   status: "success" | "failed" | "pending";
 * }
 */
export const handlePaymentWebhook = asyncHandler(
  async (req: Request, res: Response) => {
     console.log("[Webhook] Payment webhook received:", JSON.stringify(req.body, null, 2));
    console.log("[Webhook] Headers:", JSON.stringify(req.headers, null, 2));

    if (!verifyWebhookSecret(req)) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { paymentId, status } = req.body;

    /** ------------------ 1. Validate payload ------------------ */
    if (!paymentId || !status) {
      return res.status(400).json({
        success: false,
        message: "Invalid webhook payload",
      });
    }

    /** ------------------ 2. Find payment by partner reference ------------------ */
    const payment = await Payment.findOne({
      paymentReference: paymentId,
    });

    // Always ACK partner even if we can't find the payment
    if (!payment) {
      console.warn(`[Webhook] Payment not found: ${paymentId}`);
      return res.status(200).json({ received: true });
    }

    /** ------------------ 3. Idempotency guard ------------------ */
    if (payment.status === "success" || payment.status === "failed") {
      return res.status(200).json({ received: true });
    }

    /** ------------------ 4. Normalize status ------------------ */
    let normalizedStatus: "pending" | "success" | "failed";

    switch (status) {
      case "success":
      case "paid":
        normalizedStatus = "success";
        break;
      case "failed":
      case "cancelled":
        normalizedStatus = "failed";
        break;
      default:
        normalizedStatus = "pending";
    }

    /** ------------------ 5. Update Payment ------------------ */
    payment.status = normalizedStatus;
    payment.rawResponse = req.body;
    await payment.save();

    /** ------------------ 6. Update Order (terminal states only) ------------------ */
    if (normalizedStatus === "success") {
      await Order.findByIdAndUpdate(payment.orderId, {
        paymentStatus: "paid",
      });
    }

    if (normalizedStatus === "failed") {
      await Order.findByIdAndUpdate(payment.orderId, {
        paymentStatus: "failed",
      });
    }

    /** ------------------ 7. ACK partner ------------------ */
    return res.status(200).json({ received: true });
  }
);


export const handleDeliveryWebhook = asyncHandler(
  async (req: Request, res: Response) => {
    if (!verifyWebhookSecret(req)) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    console.log("[DeliveryWebhook] Received:", JSON.stringify(req.body, null, 2));

    const { orderId, status } = req.body;

    if (!orderId || !status) {
      return res.status(400).json({ success: false, message: "Invalid delivery webhook payload" });
    }

    const normalizedStatus = String(status).toLowerCase();
    if (!VALID_DELIVERY_STATUSES.includes(normalizedStatus)) {
      console.warn(`[DeliveryWebhook] Invalid status: ${status}`);
      return res.status(400).json({ success: false, message: "Invalid status value" });
    }

    // ✅ Try partnerOrderCode first, then partnerOrderId
    let order = await Order.findOne({ partnerOrderCode: orderId });
    if (!order) order = await Order.findOne({ partnerOrderId: orderId });

    if (!order) {
      console.warn(`[DeliveryWebhook] Order not found for orderId=${orderId}`);
      return res.status(200).json({ received: true }); // ACK anyway
    }

    order.deliveryStatus = normalizedStatus as any;
    await order.save();

    // ✅ Notify user of delivery update
if (order.userId) {
  try {
    const { NotificationService } = await import("../services/NotificationService");
    await NotificationService.notifyDeliveryUpdate(
      order.userId.toString(),
      order._id.toString(),
      order.orderNumber,
      normalizedStatus,
    );
  } catch (err) {
    console.error("[DeliveryWebhook] Notification failed:", err);
  }
}

    console.log(`[DeliveryWebhook] Order ${order._id} delivery updated to: ${normalizedStatus}`);
    return res.status(200).json({ received: true });
  }
);
