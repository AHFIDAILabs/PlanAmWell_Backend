import { Request, Response } from "express";
import asyncHandler from "../middleware/asyncHandler";
import { Payment } from "../models/initiatedPayment";
import axios from "axios";
import { Order } from "../models/order";
import { User } from "../models/user";
import { Cart } from "../models/cart";

const PARTNER_API_URL = process.env.PARTNER_API_URL;
const PARTNER_API_KEY = process.env.PARTNER_API_KEY;

// ------------------ GET PAYMENT METHODS ------------------
export const getPaymentMethods = asyncHandler(
  async (req: Request, res: Response) => {
    // In a real scenario, we might fetch this from the partner API or our own DB.
    // For now, we'll return a mocked list of saved cards to match the UI design.
    const methods = [
      {
        id: "1",
        type: "Mastercard",
        last4: "1234",
        expiry: "08/25",
        isDefault: true,
      },
      {
        id: "2",
        type: "Visa",
        last4: "5678",
        expiry: "06/26",
        isDefault: false,
      },
    ];

    res.status(200).json({
      success: true,
      data: methods,
    });
  },
);

export const initiatePayment = asyncHandler(
  async (req: Request, res: Response) => {
    const { orderId, paymentMethod } = req.body;

    /** ------------------ 1. Basic validation ------------------ */
    if (!orderId || !paymentMethod) {
      return res.status(400).json({
        success: false,
        message: "orderId and paymentMethod are required",
      });
    }

    /** ------------------ 2. Load order ------------------ */
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    /** ------------------ 3. Validate order state ------------------ */
    if (order.paymentStatus !== "pending") {
      return res.status(422).json({
        success: false,
        message: "Order is not eligible for payment",
      });
    }

    if (!order.partnerOrderId) {
      return res.status(422).json({
        success: false,
        message: "Partner order ID missing",
      });
    }

    if (!order.userId) {
      return res.status(422).json({
        success: false,
        message: "Order has no associated user",
      });
    }

    /** ------------------ 4. Load user ------------------ */
    const user = await User.findById(order.userId);
    if (!user || !user.partnerId) {
      return res.status(422).json({
        success: false,
        message: "User not synced with partner system",
      });
    }

    /** ------------------ 5. Idempotency check ------------------ */
    const existingPayment = await Payment.findOne({
      orderId: order.id,
      status: "pending",
    });

    if (existingPayment) {
      return res.status(200).json({
        success: true,
        message: "Payment already initiated",
        data: {
          checkoutUrl: existingPayment.checkoutUrl,
          paymentReference: existingPayment.paymentReference,
          transactionId: existingPayment.transactionId,
          status: existingPayment.status,
        },
      });
    }

    /** ------------------ 6. Derive secure server-side values ------------------ */
    const amount = order.total;

    // ✅ Use the actual partner order UUID returned during checkout
    const partnerOrderUuid = order.partnerOrderId;
    if (!partnerOrderUuid) {
      return res.status(422).json({
        success: false,
        message: "Partner order ID missing — cannot initiate payment",
      });
    }
    const partnerReferenceCode = `PAW-${order.orderNumber}`; // your idempotency key, fine as-is
    const partnerUserId = user.partnerId;

    /** ------------------ 7. Initiate payment with partner ------------------ */

    let partnerResponse;

    try {
      const response = await axios.post(
        `${PARTNER_API_URL}/v1/PlanAmWell/payments/initiate`,
        {
          orderId: partnerOrderUuid, // ✅ partner's own order UUID
          userId: partnerUserId, // ✅ partner's user UUID
          paymentMethod,
          amount,
          partnerReferenceCode,
          customerEmail: user.email,
          apiKey: PARTNER_API_KEY,
        },
      );

      console.log(
        "[Partner Raw Response]",
        JSON.stringify(response.data, null, 2),
      );

      console.log("[Payment] Sending to partner:", {
        orderId: partnerOrderUuid,
        userId: partnerUserId,
        amount,
        partnerReferenceCode,
      });

      // ✅ CORRECT extraction based on REAL response
      const initializedPayment = response.data?.initializedPayment;
      const payment = response.data?.payment;

      partnerResponse = {
        checkoutUrl: initializedPayment?.data?.authorization_url,
        paymentReference: initializedPayment?.data?.reference,
        transactionId: payment?.transactionId,
      };
    } catch (err: any) {
      console.error(
        "[initiatePayment] Partner API failed:",
        err.response?.data || err.message,
      );

      return res.status(502).json({
        success: false,
        message: "Failed to initiate payment with partner",
      });
    }

    // ✅ Validate against correct object
    if (
      !partnerResponse?.paymentReference ||
      !partnerResponse?.transactionId ||
      !partnerResponse?.checkoutUrl
    ) {
      console.error(
        "[initiatePayment] Invalid partner response:",
        partnerResponse,
      );
      return res.status(500).json({
        success: false,
        message: "Invalid response from payment provider",
      });
    }

    /** ------------------ 8. Persist payment ------------------ */
    const payment = await Payment.create({
      orderId: order.id,
      userId: user.id,
      paymentMethod,
      partnerReferenceCode,
      paymentReference: partnerResponse.paymentReference,
      transactionId: partnerResponse.transactionId,
      checkoutUrl: partnerResponse.checkoutUrl,
      amount,
      status: "pending",
    });

    /** ------------------ 9. Respond to frontend ------------------ */
    return res.status(201).json({
      success: true,
      message: "Payment initiated successfully",
      data: {
        checkoutUrl: payment.checkoutUrl,
        paymentReference: payment.paymentReference,
        transactionId: payment.transactionId,
        status: payment.status,
      },
    });
  },
);

// ------------------ VERIFY PAYMENT ------------------
export const verifyPayment = asyncHandler(async (req: Request, res: Response) => {
  const { paymentReference } = req.body;

  if (!paymentReference) {
    return res.status(400).json({ success: false, message: "paymentReference is required" });
  }

  try {
    const response = await axios.post(
      `${PARTNER_API_URL}/v1/PlanAmWell/payments/verify`,
      { paymentReference, apiKey: PARTNER_API_KEY },
    );

    const verifiedData = response.data.data || response.data;
    const isSuccess = ["success", "paid", "completed"].includes(
      verifiedData.status?.toLowerCase()
    );

    // Update payment record
    const updatedPayment = await Payment.findOneAndUpdate(
      { paymentReference },
      { status: verifiedData.status, transactionId: verifiedData.transactionId },
      { new: true },
    );

  if (isSuccess && updatedPayment) {
  const order = await Order.findByIdAndUpdate(updatedPayment.orderId, {
    paymentStatus: "paid",
  }, { new: true });

  // Delete cart by local orderId (which was set during checkout)
  await Cart.deleteOne({ orderId: updatedPayment.orderId });

  // Also clear partner cart
  if (order?.partnerOrderId && order?.userId) {
    try {
      const user = await User.findById(order.userId);
      if (user?.partnerId) {
        await axios.post(
          `${PARTNER_API_URL}/v1/PlanAmWell/cart`,
          {
            userId: user.partnerId,
            platform: "paw",
            items: [],
          }
        );
        console.log("[verifyPayment] Partner cart cleared");
      }
    } catch (err: any) {
      console.error("[verifyPayment] Partner cart clear failed:", err.response?.data || err.message);
    }
  }
}

    return res.status(200).json({
      success: true,
      message: "Payment verified successfully",
      data: verifiedData,
    });

  } catch (err: any) {
    console.error("[Payment] Verify failed:", err.response?.data || err.message);

    // and marks orders as paid when they aren't. Rather return a real error:
    return res.status(502).json({
      success: false,
      message: "Could not verify payment. Please try again or contact support.",
    });
  }
});