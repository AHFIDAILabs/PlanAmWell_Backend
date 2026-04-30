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
    // order.shippingFee was stored from the partner's "deliveryFee" field in confirmOrder.
    // Number() guards against any string coercion that slipped through before the DB save.
    const amount = Number(order.subtotal) + Number(order.shippingFee ?? 0);

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
     const mobileRedirectUrl = `planamwell://order-complete?orderId=${order._id}`;

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
          mobile_redirect_url: mobileRedirectUrl,
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

  console.log("[verifyPayment] Called with paymentReference:", paymentReference);

  if (!paymentReference) {
    return res.status(400).json({ success: false, message: "paymentReference is required" });
  }

  // ✅ Look up transactionId from our DB using paymentReference
  const paymentRecord = await Payment.findOne({ paymentReference });
  if (!paymentRecord) {
    return res.status(404).json({ success: false, message: "Payment record not found" });
  }

  const { transactionId } = paymentRecord;
  console.log("[verifyPayment] Found transactionId:", transactionId);

  try {
    console.log("[verifyPayment] Calling partner API...");

    //  GET request with transactionId as path param — no body, no apiKey
    const response = await axios.get(
      `${PARTNER_API_URL}/v1/PlanAmWell/payments/verify/${transactionId}`,
    );

    console.log("[verifyPayment] Raw partner response:", JSON.stringify(response.data, null, 2));

    const verifiedData = response.data;
    console.log("[verifyPayment] Status from partner:", verifiedData.status);

    const isSuccess = ["success", "paid", "completed", "successful"].includes(
      verifiedData.status?.toLowerCase()
    );

    console.log("[verifyPayment] isSuccess:", isSuccess);

    // Update our payment record status
 const normalizedStatus = isSuccess ? "success" : 
  ["failed", "cancelled"].includes(verifiedData.status?.toLowerCase()) ? "failed" : "pending";

const updatedPayment = await Payment.findOneAndUpdate(
  { paymentReference },
  { status: normalizedStatus }, // ← normalized, not raw partner status
  { new: true },
);
    console.log("[verifyPayment] updatedPayment:", updatedPayment ? updatedPayment._id : "NOT FOUND");

 if (isSuccess && updatedPayment) {
  const order = await Order.findByIdAndUpdate(updatedPayment.orderId, {
    paymentStatus: "paid",
  }, { new: true });

  if (order?.userId) {
    //  Send payment success notification
    try {
      const { NotificationService } = await import("../services/NotificationService");
      await NotificationService.notifyPaymentSuccessful(
        order.userId.toString(),
        order._id.toString(),
        order.orderNumber.slice(0, 8).toUpperCase(),
        order.total,
      );
    } catch (err) {
      console.error("[verifyPayment] Notification failed:", err);
    }
  }

  console.log("[verifyPayment] Order updated to paid:", order?.paymentStatus);

  //  Delete cart using multiple strategies to ensure it's found
  if (order) {
    await Cart.deleteMany({
      $or: [
        { orderId: order._id },
        { orderId: order._id.toString() },
        { userId: order.userId?.toString() },
      ]
    });
    console.log("[verifyPayment] Cart cleared for userId:", order.userId);
  }

  // Clear partner cart
  if (order?.partnerOrderId && order?.userId) {
    try {
      const user = await User.findById(order.userId);
      if (user?.partnerId) {
        await axios.post(`${PARTNER_API_URL}/v1/PlanAmWell/cart`, {
          userId: user.partnerId,
          platform: "paw",
          items: [],
        });
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
    console.error("[verifyPayment] Partner API error — status:", err.response?.status);
    console.error("[verifyPayment] Partner API error — body:", JSON.stringify(err.response?.data, null, 2));
    console.error("[verifyPayment] Local error message:", err.message);

    return res.status(502).json({
      success: false,
      message: "Could not verify payment. Please try again or contact support.",
    });
  }
});



// GET /api/v1/payment/redirect?orderId=xxx

export const paymentRedirect = asyncHandler(async (req: Request, res: Response) => {
  const { orderId } = req.query;
  
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Payment Complete</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: sans-serif; text-align: center; padding: 40px 20px; background: #f9f9f9; }
          h2 { color: #D81E5B; }
          p { color: #555; }
          a { display: inline-block; margin-top: 20px; background: #D81E5B; color: #fff; 
              padding: 14px 28px; border-radius: 12px; text-decoration: none; font-weight: 700; }
        </style>
      </head>
      <body>
        <h2>Payment Successful!</h2>
        <p>Tap below to return to the app.</p>
        <a href="planamwell://order-complete?orderId=${orderId}">Return to PlanAmWell</a>
      </body>
    </html>
  `);
});

// GET /api/v1/payments/by-order/:orderId
export const getPaymentByOrder = asyncHandler(async (req: Request, res: Response) => {
  const { orderId } = req.params;

  console.log("[getPaymentByOrder] Looking up orderId:", orderId, "| type:", typeof orderId);

  // Debug: show ALL payments to confirm record exists
  // const allPayments = await Payment.find({}).select("orderId paymentReference status").lean();
  // console.log("[getPaymentByOrder] All payments in DB:", JSON.stringify(allPayments, null, 2));

  const payment = await Payment.findOne({ orderId });
  console.log("[getPaymentByOrder] Result:", payment ? payment._id : "NOT FOUND");

  if (!payment) {
    return res.status(404).json({ success: false, message: "Payment not found" });
  }

  res.status(200).json({ success: true, data: payment });
});