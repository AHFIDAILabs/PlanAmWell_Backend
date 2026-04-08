import { Request, Response } from "express";
import asyncHandler from "../middleware/asyncHandler";
import { Payment } from "../models/initiatedPayment";
import { Order } from "../models/order";

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
    const { orderId, status } = req.body;

    if (!orderId || !status) {
      return res.status(400).json({
        success: false,
        message: "Invalid delivery webhook payload",
      });
    }

    // ⚠️ orderId here is partner order ID or orderCode
    const order = await Order.findOne({ partnerOrderId: orderId });

    if (!order) {
      console.warn(
        `[DeliveryWebhook] Order not found for partnerOrderId=${orderId}`
      );
      return res.status(200).json({ received: true });
    }

    order.deliveryStatus = status.toLowerCase();
    await order.save();

    return res.status(200).json({ received: true });
  }
);
