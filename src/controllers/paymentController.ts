import { Request, Response } from "express";
import asyncHandler from "../middleware/asyncHandler";
import { Payment } from "../models/initiatedPayment";
import axios from "axios";
import { Order } from "../models/order";
import { User } from "../models/user";
import { Cart } from "../models/cart";
import crypto from "crypto";
import { resolveRedirectUrl } from "./checkoutController";

const PARTNER_API_URL = process.env.PARTNER_API_URL;
const PARTNER_API_KEY = process.env.PARTNER_API_KEY;

// Order payments default to simulated — same on/off convention as
// PAYMENT_ENABLED for consultation payments (see appointmentController) —
// flip ORDER_PAYMENT_ENABLED=true once real Partner API credentials are
// confirmed working end-to-end. Until then every order payment is faked
// locally via renderSimulatedCheckout/completeSimulatedPayment below,
// exercising the exact same Payment/Order/notification/cart-clearing code
// paths the real flow uses — only the "call a real processor" step differs.
function orderPaymentEnabled(): boolean {
  return process.env.ORDER_PAYMENT_ENABLED === "true";
}

// RENDER_EXTERNAL_URL is set automatically on Render (https://<service>.onrender.com,
// no trailing slash) — falls back to it so the simulated checkout link works
// out of the box there without a new manual env var; BACKEND_PUBLIC_URL
// still overrides it for any other host.
const BACKEND_URL = process.env.BACKEND_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "";

/**
 * One-time side effects for an order that just transitioned to paid —
 * shared by the real verifyPayment path and the simulated-checkout
 * completion path below, so "what happens when an order gets paid" only
 * exists in one place regardless of which processor said so.
 * Idempotent: safe to call even if the order was already marked paid.
 */
async function markOrderPaid(paymentId: string): Promise<void> {
  const updatedPayment = await Payment.findById(paymentId);
  if (!updatedPayment) return;

  const orderBefore = await Order.findById(updatedPayment.orderId).select("paymentStatus");
  const alreadyPaid = orderBefore?.paymentStatus === "paid";

  const order = await Order.findByIdAndUpdate(updatedPayment.orderId, { paymentStatus: "paid" }, { new: true });
  if (alreadyPaid || !order) return;

  if (order.userId) {
    try {
      const { NotificationService } = await import("../services/NotificationService");
      await NotificationService.notifyPaymentSuccessful(
        order.userId.toString(),
        order._id.toString(),
        order.orderNumber.slice(0, 8).toUpperCase(),
        order.total
      );
    } catch (err) {
      console.error("[markOrderPaid] Notification failed:", err);
    }
  }

  await Cart.deleteMany({
    $or: [{ orderId: order._id }, { orderId: order._id.toString() }, { userId: order.userId?.toString() }],
  });

  // Clearing the partner's own cart only makes sense for a real, partner-
  // synced order — a simulated payment's order may never have gone through
  // partner checkout at all.
  if (order.partnerOrderId && order.userId) {
    try {
      const user = await User.findById(order.userId);
      if (user?.partnerId) {
        await axios.post(`${PARTNER_API_URL}/v1/PlanAmWell/cart`, {
          userId: user.partnerId,
          platform: "paw",
          items: [],
        });
      }
    } catch (err: any) {
      console.error("[markOrderPaid] Partner cart clear failed:", err.response?.data || err.message);
    }
  }
}

export const initiatePayment = asyncHandler(
  async (req: Request, res: Response) => {
    const { orderId } = req.body;
    // paymentMethod was always accepted but never actually used to select
    // anything — the real checkout is fully hosted by the partner/provider,
    // which shows its own card/bank/USSD picker. Kept only as a DB field
    // default, no longer required from the client.
    const paymentMethod = req.body.paymentMethod || "card";

    /** ------------------ 1. Basic validation ------------------ */
    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "orderId is required",
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

    if (!order.userId) {
      return res.status(422).json({
        success: false,
        message: "Order has no associated user",
      });
    }

    /** ------------------ 4. Load user ------------------ */
    const user = await User.findById(order.userId);
    if (!user) {
      return res.status(422).json({
        success: false,
        message: "User not found",
      });
    }

 /** ------------------ 5. Idempotency check ------------------ */
// Only a still-pending payment should short-circuit here — a failed one
// left behind (very reachable now via the simulated "Simulate Failed
// Payment" button, previously only ever a rare real-processor outcome)
// must not permanently block ever retrying this order.
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
    // order.shippingFee was stored from the partner's "deliveryFee" field in confirmOrder.
    // Number() guards against any string coercion that slipped through before the DB save.
    const amount = Number(order.subtotal) + Number(order.shippingFee ?? 0);
    const partnerReferenceCode = `PAW-${order.orderNumber}`; // your idempotency key, fine as-is
    // Same resolution checkoutController.confirmOrder uses for a fresh
    // order — a caller-supplied web origin if trusted, else the mobile deep
    // link fallback. Previously hardcoded to the mobile scheme here
    // regardless of which platform actually initiated this payment.
    const resolvedRedirectUrl = resolveRedirectUrl(String(order._id), req.body.redirectUrl);

    /** ------------------ 7a. Simulated path (default) ------------------ */
    // No partner call at all — a locally-generated reference and a
    // self-hosted "fake checkout" page (renderSimulatedCheckout below) that
    // lets a tester pick success or failure, then runs through the exact
    // same markOrderPaid() the real webhook/verify path uses. Doesn't
    // require the order/user to be partner-synced at all, unlike the real
    // path below — deliberately, so simulation works even before partner
    // integration is fully wired up.
    if (!orderPaymentEnabled()) {
      const simReference = `SIM-${partnerReferenceCode}-${crypto.randomBytes(4).toString("hex")}`;
      const payment = await Payment.create({
        orderId: order.id,
        userId: user.id,
        paymentMethod,
        partnerReferenceCode,
        paymentReference: simReference,
        transactionId: simReference,
        checkoutUrl: `${BACKEND_URL}/api/v1/payment/simulate/${simReference}`,
        amount,
        status: "pending",
        provider: "simulation",
        redirectUrl: resolvedRedirectUrl,
      });

      return res.status(201).json({
        success: true,
        message: "Payment initiated (simulation)",
        data: {
          checkoutUrl: payment.checkoutUrl,
          paymentReference: payment.paymentReference,
          transactionId: payment.transactionId,
          status: payment.status,
        },
      });
    }

    /** ------------------ 7b. Real path — Partner API ------------------ */
    if (!order.partnerOrderId) {
      return res.status(422).json({
        success: false,
        message: "Partner order ID missing",
      });
    }
    if (!user.partnerId) {
      return res.status(422).json({
        success: false,
        message: "User not synced with partner system",
      });
    }
    const partnerOrderUuid = order.partnerOrderId;
    const partnerUserId = user.partnerId;

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
          mobile_redirect_url: resolvedRedirectUrl,
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
      redirectUrl: resolvedRedirectUrl,
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

  // A simulated payment has no real processor to ask — its status is
  // whatever completeSimulatedPayment already wrote to this same record.
  // Calling the real partner's verify endpoint with a fake transactionId
  // would just 404/error against them for no reason.
  if (paymentRecord.provider === "simulation") {
    if (paymentRecord.status === "success") {
      await markOrderPaid(paymentRecord.id);
    }
    return res.status(200).json({
      success: true,
      message: "Payment verified successfully",
      data: { status: paymentRecord.status },
    });
  }

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

    // markOrderPaid is itself idempotent (checks alreadyPaid) — verifyPayment
    // can legitimately be called more than once for the same payment (client
    // polling, user re-opening the redirect page).
    if (isSuccess && updatedPayment) {
      await markOrderPaid(updatedPayment.id);
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

// ------------------ SIMULATED CHECKOUT (ORDER_PAYMENT_ENABLED=false) ------------------
// A self-hosted stand-in for the real hosted checkout page a payment
// processor would normally serve — same role, same shape (mobile opens this
// URL in a browser, it ends in a redirect back into the app), just no real
// money or third party involved. Lets the whole order-payment flow (this
// page → app deep link → useOrderDetails' verify-and-refresh → paid order)
// be exercised end-to-end before real Partner API credentials are ready.

// GET /api/v1/payment/simulate/:reference
export const renderSimulatedCheckout = asyncHandler(async (req: Request, res: Response) => {
  const { reference } = req.params;
  const payment = await Payment.findOne({ paymentReference: reference, provider: "simulation" });

  if (!payment) {
    return res.status(404).send("<h2>Simulated payment not found</h2>");
  }

  if (payment.status !== "pending") {
    return res.send(renderSimulationResultPage(payment.status === "success", paymentRedirectUrl(payment)));
  }

  const amountNaira = payment.amount.toLocaleString();
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Simulated Checkout</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: sans-serif; text-align: center; padding: 40px 20px; background: #f9f9f9; }
          .badge { display: inline-block; background: #FEF3C7; color: #92400E; font-size: 12px; font-weight: 700;
                   padding: 6px 14px; border-radius: 999px; margin-bottom: 20px; }
          h2 { color: #222; margin: 0 0 6px; }
          .amount { font-size: 32px; font-weight: 800; color: #D81E5B; margin: 16px 0 28px; }
          button { display: block; width: 100%; max-width: 320px; margin: 0 auto 14px; padding: 16px;
                    border-radius: 12px; border: none; font-size: 16px; font-weight: 700; cursor: pointer; }
          .success { background: #D81E5B; color: #fff; }
          .fail { background: #fff; color: #666; border: 1.5px solid #ddd; }
        </style>
      </head>
      <body>
        <span class="badge">SIMULATION — no real payment</span>
        <h2>Complete this order</h2>
        <p class="amount">₦${amountNaira}</p>
        <form method="POST" action="/api/v1/payment/simulate/${reference}/complete">
          <button class="success" name="outcome" value="success" type="submit">Simulate Successful Payment</button>
          <button class="fail" name="outcome" value="failed" type="submit">Simulate Failed Payment</button>
        </form>
      </body>
    </html>
  `);
});

// POST /api/v1/payment/simulate/:reference/complete
export const completeSimulatedPayment = asyncHandler(async (req: Request, res: Response) => {
  const { reference } = req.params;
  const outcome = req.body?.outcome === "failed" ? "failed" : "success";

  const payment = await Payment.findOneAndUpdate(
    { paymentReference: reference, provider: "simulation", status: "pending" },
    { status: outcome },
    { new: true }
  );

  if (!payment) {
    // Either unknown reference or already resolved — show whatever the
    // current state is rather than a dead end.
    const existing = await Payment.findOne({ paymentReference: reference, provider: "simulation" });
    if (!existing) return res.status(404).send("<h2>Simulated payment not found</h2>");
    return res.send(renderSimulationResultPage(existing.status === "success", paymentRedirectUrl(existing)));
  }

  if (outcome === "success") {
    await markOrderPaid(payment.id);
  }

  return res.send(renderSimulationResultPage(outcome === "success", paymentRedirectUrl(payment)));
});

// A payment created before the redirectUrl field existed would have none
// stored — falls back to the same mobile-deep-link default
// resolveRedirectUrl itself uses when no web origin was supplied.
function paymentRedirectUrl(payment: { orderId: string; redirectUrl?: string }): string {
  return payment.redirectUrl || `planamwell://order-complete?orderId=${payment.orderId}`;
}

function renderSimulationResultPage(success: boolean, redirectUrl: string): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>${success ? "Payment Successful" : "Payment Failed"}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: sans-serif; text-align: center; padding: 40px 20px; background: #f9f9f9; }
          h2 { color: ${success ? "#15803D" : "#DC2626"}; }
          p { color: #555; }
          a { display: inline-block; margin-top: 20px; background: #D81E5B; color: #fff;
              padding: 14px 28px; border-radius: 12px; text-decoration: none; font-weight: 700; }
        </style>
      </head>
      <body>
        <h2>${success ? "Payment Successful! (Simulated)" : "Payment Failed (Simulated)"}</h2>
        <p>Tap below to continue.</p>
        <a href="${redirectUrl}">Return to PlanAmWell</a>
      </body>
    </html>
  `;
}

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

  // Sorted — an order can now have more than one Payment record (a failed
  // attempt no longer blocks retrying, see initiatePayment's idempotency
  // check), and an unsorted findOne isn't guaranteed to return the latest
  // one, which would make the caller verify against a stale attempt.
  const payment = await Payment.findOne({ orderId }).sort({ createdAt: -1 });
  console.log("[getPaymentByOrder] Result:", payment ? payment._id : "NOT FOUND");

  if (!payment) {
    return res.status(404).json({ success: false, message: "Payment not found" });
  }

  res.status(200).json({ success: true, data: payment });
});