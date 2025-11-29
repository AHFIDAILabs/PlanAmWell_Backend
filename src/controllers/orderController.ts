import { Request, Response } from "express";
import axios from "axios";
import asyncHandler from "../middleware/asyncHandler";
import { Order } from "../models/order";
import { IOrderItem } from "../types";
import { v4 as uuidv4 } from "uuid";

const API_BASE = process.env.PARTNER_API_URL;

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

  const sessionId = req.user?.sessionId || req.query.sessionId;
  const userId = req.user?.userId;

  const isOwner =
    (userId && order.userId?.toString() === userId.toString()) ||
    (sessionId && order.sessionId === sessionId);

  if (!isOwner && req.user?.role !== "Admin") {
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

  // --- Prepare Partner API Payload ---
  const apiItems = items.map((item: IOrderItem) => ({
    drugId: item.productId,
    quantity: item.qty,
    dosage: item.dosage || "",
    specialInstructions: item.specialInstructions || "",
  }));

  const apiPayload = {
    userId: userId || undefined, // Never send sessionId
    telephone: shippingAddress?.phone || "",
    address: shippingAddress?.addressLine || "",
    state: shippingAddress?.state || "",
    lga: shippingAddress?.city || "",
    isHomeAddress: true,
    isThirdPartyOrder: true,
    platform: "PlanAmWell",
    items: apiItems,
  };

  // --- Sync with Partner API ---
  let partnerResponse: any = "Failed to sync with partner API";

  try {
    const response = await axios.post(`${API_BASE}/orders`, apiPayload);
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

  const sessionId = req.user?.sessionId || req.body.sessionId;
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
