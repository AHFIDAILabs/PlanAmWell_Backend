import { Router } from "express";
import {
  getOrders,
  getMyOrders,
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
orderRouter.get("/:id/delivery-status", refreshDeliveryStatus);

/**
 * USER - list their own orders. Must be registered before "/:id" —
 * Express matches in registration order, so "/:id" would otherwise swallow
 * "/my" as a request for the order with id "my" (same class of bug fixed on
 * productRoutes.ts's "/search").
 */
orderRouter.get("/my", verifyToken, authorize("User"), getMyOrders);

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

/**
 * ADMIN ONLY - delete order
 */
orderRouter.delete("/:id", verifyToken, authorize("Admin"), deleteOrder);

export default orderRouter;
