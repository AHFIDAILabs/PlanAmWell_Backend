import { Router } from "express";
import rateLimit from "express-rate-limit";
import { checkout, confirmOrder, getDeliveryFee, getDeliveryZones } from "../controllers/checkoutController";
import { guestAuth, verifyToken } from "../middleware/auth";
import { keyByUserOrIp } from "../middleware/rateLimit";

const checkoutRouter = Router();

// A real checkout normally happens once or twice per cart — tighter than
// the global default, keyed by account (guestAuth + verifyToken have
// already run by the time this executes, so req.auth is populated).
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUserOrIp,
  message: { success: false, message: "Too many checkout attempts. Please try again in a few minutes." },
});

// Public - anyone can initiate checkout
checkoutRouter.get("/delivery-zones", getDeliveryZones);
checkoutRouter.get("/delivery-fee", getDeliveryFee);
checkoutRouter.post("/", guestAuth, verifyToken, checkoutLimiter, checkout);
checkoutRouter.post("/confirm", guestAuth, verifyToken, checkoutLimiter, confirmOrder);

export default checkoutRouter;