import { Router } from "express";
import {
  getOrders,
  getOrder,
  createOrder,
  updateOrder,
  deleteOrder,
  refreshDeliveryStatus
} from "../controllers/orderController";
import { verifyToken, authorize } from "../middleware/auth";
import { User } from "../models/user";

const orderRouter = Router();

/**
 * PUBLIC - anyone can create an order (guest or registered user)
 */
orderRouter.post("/", createOrder);

/**
 * ADMIN - get all orders
 */
orderRouter.get("/", verifyToken, authorize("Admin"), getOrders);

/**
 * ADMIN OR USER/SESSION OWNER - get single order
 */
orderRouter.get("/:id", verifyToken, authorize("Admin", "User"), getOrder);

/**
 * USER/SESSION OWNER - update their own order if not paid
 */
orderRouter.put("/:id",  updateOrder);
orderRouter.get("/:id/delivery-status", refreshDeliveryStatus);

/**
 * ADMIN ONLY - delete order
 */
orderRouter.delete("/:id", verifyToken, authorize("Admin"), deleteOrder);

export default orderRouter;
