import { Request, Response } from "express";
import axios from "axios";
import asyncHandler from "../middleware/asyncHandler";
import { Order, IOrderItem } from "../models/order";
import { v4 as uuidv4 } from "uuid";
import { createOrderNotification } from "../util/sendPushNotification";
import { Product } from "../models/product";
import { User } from "../models/user";

const API_BASE = process.env.PARTNER_API_URL;

const VALID_PAYMENT_STATUSES = ["pending", "paid", "failed", "refunded"];
const VALID_DELIVERY_STATUSES = ["pending", "processing", "shipped", "delivered", "cancelled", "failed"];

/**
 * ADMIN: Get all orders
 */
export const getOrders = asyncHandler(async (req: Request, res: Response) => {
  const orders = await Order.find();
  res.status(200).json({ success: true, data: orders });
});

/**
 * Get the authenticated user's own orders, most recent first. There was no
 * patient-facing "list my orders" endpoint before this — GET / is Admin-only
 * and GET /:id requires already knowing an order's id — so an Order History
 * page had nothing to call.
 */
export const getMyOrders = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.auth?.id;
  if (!userId) {
    res.status(401);
    throw new Error("Not authenticated");
  }

  const orders = await Order.find({ userId }).sort({ createdAt: -1 });
  res.status(200).json({ success: true, data: orders });
});

/**
 * Get one order (Owner or Admin)
 */
export const getOrder = asyncHandler(async (req: Request, res: Response) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    res.status(404);
    throw new Error("Order not found");
  }

  // ✅ Use req.auth instead of req.user
  const sessionId = req.auth?.sessionId;
  const userId = req.auth?.id;  // 

  const isOwner =
    (userId && order.userId?.toString() === userId.toString()) ||
    (sessionId && order.sessionId === sessionId);

  if (!isOwner && req.auth?.role !== "Admin") {  // ← was req.user?.role
    res.status(403);
    throw new Error("Forbidden - Not your order");
  }

  res.status(200).json({ success: true, data: order });
});

/**
 * Create order (Guest or Registered)
 */
export const createOrder = asyncHandler(async (req: Request, res: Response) => {
  const {
    items,
    shippingFee,
    discreetPackaging = false,
    shippingAddress,
  } = req.body;

  // ✅ Use req.auth (set by guestAuth) instead of req.user, which nothing on
  // this route ever populated — every order previously had userId/sessionId
  // silently undefined regardless of who was actually calling.
  const userId = req.auth?.id || undefined;
  const sessionId = userId ? undefined : req.auth?.sessionId;

  if (!Array.isArray(items) || items.length === 0) {
    res.status(400);
    throw new Error("At least one item is required");
  }

  // Price is never trusted from the client — every item's price (and the
  // resulting subtotal) is looked up fresh from the Product collection here.
  // A client that submitted a fabricated subtotal/total previously got
  // exactly that amount charged; this closes that gap the same way
  // checkoutController.checkout already prices from the server-side cart.
  const resolvedItems: IOrderItem[] = [];
  const productLookups = new Map<string, any>();
  let subtotal = 0;

  for (const item of items) {
    const qty = Math.max(1, Math.floor(Number(item?.qty) || 0));
    if (!item?.productId || qty < 1) {
      res.status(400);
      throw new Error("Each item requires a valid productId and quantity");
    }

    let product = productLookups.get(item.productId);
    if (!product) {
      product = await Product.findById(item.productId);
      if (!product) {
        res.status(400);
        throw new Error(`Product not found for id: ${item.productId}`);
      }
      productLookups.set(item.productId, product);
    }

    subtotal += product.price * qty;
    resolvedItems.push({
      productId: item.productId,
      name: product.name,
      sku: product.sku,
      qty,
      price: product.price,
      dosage: item.dosage || "",
      specialInstructions: item.specialInstructions || "",
    });
  }

  const safeShippingFee = typeof shippingFee === "number" && shippingFee >= 0 ? shippingFee : 0;

let partnerUserId: string | undefined;
if (userId) {
  const user = await User.findById(userId);
  partnerUserId = user?.partnerId;
  if (!partnerUserId) {
    console.warn("[OrderController] User has no partnerId, order will sync without userId");
  }
}

  // --- Create local Order ---
  const order = await Order.create({
    orderNumber: uuidv4(),
    userId,
    sessionId,
    items: resolvedItems,
    subtotal,
    shippingFee: safeShippingFee,
    total: subtotal + safeShippingFee,
    discreetPackaging,
    shippingAddress,
    paymentStatus: "pending",
    deliveryStatus: "pending",
    deliveryMethod: "delivery",
  });

  // ✅ Send order placed notification (only for registered users)
  if (userId) {
    try {
      await createOrderNotification(
        userId.toString(),
        "User", // ✅ userType parameter
        (order._id as any).toString(),
        "placed",
        `Your order #${order.orderNumber.slice(0, 8)} has been placed successfully!`
      );
    } catch (notifError) {
      console.error("[OrderController] Failed to send notification:", notifError);
      // Don't fail the order creation if notification fails
    }
  }

 
  // --- Sync with Partner API — reuses the lookups already done above
  // instead of re-fetching the same products again. ---
  const apiItems = resolvedItems.map((item) => {
    const product = productLookups.get(item.productId);
    return {
      drugId: product.partnerProductId, // ✅ Partner UUID, not Mongo ObjectId
      quantity: item.qty,
      dosage: item.dosage || "",
      special_instructions: item.specialInstructions || "",
    };
  });

const apiPayload = {
  userId: partnerUserId || undefined,
  telephone: shippingAddress?.phone || "",
  address: shippingAddress?.addressLine || "",
  state: shippingAddress?.state || "",
  lga: shippingAddress?.lga || "",
  isHomeAddress: true,
  isThirdPartyOrder: true,
  platform: "paw",
  items: apiItems,
};

  // --- Sync with Partner API ---
  let partnerResponse: any = "Failed to sync with partner API";

  try {
    const response = await axios.post(`${API_BASE}/v1/PlanAmWell/orders`, apiPayload);
    partnerResponse = response.data;
console.log("[createOrder] Partner response data:", JSON.stringify(response.data, null, 2));
console.log("[createOrder] partnerOrderId being saved:", response.data?.id);

    // Save partner order data and update totals with the partner's confirmed delivery fee
    const partnerData = response.data?.data;
    order.partnerOrderId = partnerData?.orderId;
    order.partnerOrderCode = partnerData?.orderCode;
    const partnerDeliveryFee = Number(partnerData?.deliveryFee ?? partnerData?.shippingFee ?? 0);
    order.shippingFee = partnerDeliveryFee;
    order.total = Number(order.subtotal) + partnerDeliveryFee;
    await order.save();
  } catch (err: any) {
    console.error("[OrderController] Partner sync failed:", err.response?.data || err.message);
  }

  res.status(201).json({
    success: true,
    data: order,
    partner: partnerResponse,
  });
});

/**
 * Update order (Owner or Admin)
 */
export const updateOrder = asyncHandler(async (req: Request, res: Response) => {
  const order = await Order.findById(req.params.id);
  if (!order) {
    res.status(404);
    throw new Error("Order not found");
  }

  // Only trust sessionId/userId from the auth token — never from request
  // body. Was reading req.user, which nothing on this route ever populated
  // (same dead pattern fixed for createOrder/getOrder), so this route
  // rejected every caller regardless of actual ownership.
  const sessionId = req.auth?.sessionId;
  const userId = req.auth?.id;

  const isOwner =
    (userId && order.userId?.toString() === userId.toString()) ||
    (sessionId && order.sessionId === sessionId);

  if (!isOwner && req.auth?.role !== "Admin") {
    res.status(403);
    throw new Error("Forbidden");
  }

  if (order.paymentStatus === "paid") {
    res.status(400);
    throw new Error("Cannot update a paid order");
  }

  const allowedFields = ["items", "shippingAddress", "discreetPackaging"];
  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      (order as any)[field] = req.body[field];
    }
  });

  await order.save();

  res.status(200).json({ success: true, data: order });
});

/**
 * Admin: Update order status (payment or delivery)
 * ✅ Sends notifications on status changes
 */
export const updateOrderStatus = asyncHandler(async (req: Request, res: Response) => {
  const { paymentStatus, deliveryStatus } = req.body;
  const order = await Order.findById(req.params.id);

  if (!order) {
    res.status(404);
    throw new Error("Order not found");
  }

  if (paymentStatus && !VALID_PAYMENT_STATUSES.includes(paymentStatus)) {
    return res.status(400).json({ success: false, message: "Invalid payment status" });
  }
  if (deliveryStatus && !VALID_DELIVERY_STATUSES.includes(deliveryStatus)) {
    return res.status(400).json({ success: false, message: "Invalid delivery status" });
  }

  // Update statuses if provided
  if (paymentStatus) order.paymentStatus = paymentStatus;
  if (deliveryStatus) order.deliveryStatus = deliveryStatus;

  await order.save();

  // ✅ Send notification based on delivery status change (only for registered users)
  if (deliveryStatus && order.userId) {
    try {
      // Map Order deliveryStatus to notification status types
      type NotificationStatus = "placed" | "confirmed" | "shipped" | "delivered" | "cancelled";
      
      const statusMap: Record<string, NotificationStatus> = {
        pending: "placed",
        shipped: "shipped",
        delivered: "delivered",
        cancelled: "cancelled",
      };
      
      const statusMessages: Record<string, string> = {
        pending: `Order #${order.orderNumber.slice(0, 8)} is being processed`,
        shipped: `Order #${order.orderNumber.slice(0, 8)} has been shipped!`,
        delivered: `Order #${order.orderNumber.slice(0, 8)} has been delivered. Enjoy!`,
        cancelled: `Order #${order.orderNumber.slice(0, 8)} has been cancelled`,
      };

      // ✅ Check if deliveryStatus is valid and map to notification type
      if (deliveryStatus in statusMap && deliveryStatus in statusMessages) {
        await createOrderNotification(
          order.userId.toString(),
          "User", // ✅ userType parameter
          (order._id as any).toString(),
          statusMap[deliveryStatus],
          statusMessages[deliveryStatus]
        );
      }
    } catch (notifError) {
      console.error("[OrderController] Failed to send status notification:", notifError);
    }
  }

  res.status(200).json({ success: true, data: order });
});

/**
 * Admin: Delete order
 */
export const deleteOrder = asyncHandler(async (req: Request, res: Response) => {
  const order = await Order.findByIdAndDelete(req.params.id);
  if (!order) {
    res.status(404);
    throw new Error("Order not found");
  }
  res.status(200).json({ success: true, message: "Order deleted successfully" });
});



export const refreshDeliveryStatus = asyncHandler(
  async (req: Request, res: Response) => {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

 const code = order.partnerOrderCode || order.partnerOrderId;

if (!code) {
  return res.status(404).json({ message: "Partner order code not found" });
}

try {
  const response = await axios.get(
    `${API_BASE}/v1/PlanAmWell/delivery/${code}`
  );

      console.log("[refreshDeliveryStatus] Partner response:", JSON.stringify(response.data, null, 2));

      const incomingStatus = String(
        response.data.status || response.data.deliveryStatus || "pending"
      ).toLowerCase();

      if (VALID_DELIVERY_STATUSES.includes(incomingStatus)) {
        order.deliveryStatus = incomingStatus as any;
        await order.save();
      }

      res.json({ success: true, deliveryStatus: order.deliveryStatus, data: response.data });
    } catch (err: any) {
      console.error("[refreshDeliveryStatus] Failed:", err.response?.data || err.message);
      return res.status(502).json({ message: "Could not fetch delivery status from partner" });
    }
  }
);
