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
    subtotal,
    shippingFee = 0,
    total,
    discreetPackaging = false,
    shippingAddress,
  } = req.body;

  const userId = req.user?.userId || undefined;
  const sessionId = userId ? undefined : req.user?.sessionId;

  
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
    items,
    subtotal,
    shippingFee,
    total,
    discreetPackaging,
    shippingAddress,
    paymentStatus: "pending",
    deliveryStatus: "pending",
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

 
  // --- Sync with Partner API ---
const apiItems = await Promise.all(
  items.map(async (item: IOrderItem) => {
    const product = await Product.findById(item.productId);
    if (!product) {
      throw new Error(`Product not found for id: ${item.productId}`);
    }
    return {
      drug_id: product.partnerProductId, // ✅ Partner UUID, not Mongo ObjectId
      quantity: item.qty,
      dosage: item.dosage || "",
      special_instructions: item.specialInstructions || "",
    };
  })
);

const apiPayload = {
  userId: partnerUserId || undefined,
  telephone: shippingAddress?.phone || "",
  address: shippingAddress?.addressLine || "",
  state: shippingAddress?.state || "",
  lga: shippingAddress?.city || "",
  isHomeAddress: true,
  isThirdPartyOrder: true,
  platform: "PlanAmWell",
  items: apiItems, // ✅ now has correct partner UUIDs
};

  // --- Sync with Partner API ---
  let partnerResponse: any = "Failed to sync with partner API";

  try {
    const response = await axios.post(`${API_BASE}/v1/PlanAmWell/orders`, apiPayload);
    partnerResponse = response.data;

    // Save partner order ID
    order.partnerOrderId = response.data?.id;
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

  // Only trust sessionId from the auth token — never from request body
  const sessionId = req.user?.sessionId;
  const userId = req.user?.userId;

  const isOwner =
    (userId && order.userId?.toString() === userId.toString()) ||
    (sessionId && order.sessionId === sessionId);

  if (!isOwner && req.user?.role !== "Admin") {
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

    if (!order || !order.partnerOrderId) {
      return res.status(404).json({ message: "Order not found" });
    }

    const response = await axios.get(
      `${API_BASE}/v1/PlanAmWell/delivery/${order.partnerOrderId}`
    );

    // Validate status from partner before storing
    const incomingStatus = String(response.data.status).toLowerCase();
    if (!VALID_DELIVERY_STATUSES.includes(incomingStatus)) {
      return res.status(502).json({ message: "Invalid delivery status from partner API" });
    }
    order.deliveryStatus = incomingStatus as any;
    await order.save();

    res.json({ success: true, data: order.deliveryStatus });
  }
);
