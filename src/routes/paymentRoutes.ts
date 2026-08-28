
import { Router } from "express";
import {
  initiatePayment,
  paymentRedirect,
  getPaymentByOrder,
  verifyPayment,
  renderSimulatedCheckout,
  completeSimulatedPayment,
} from "../controllers/paymentController";
import { guestAuth } from "../middleware/auth";

const paymentRouter = Router();

// Allow guests to initiate/verify payment
paymentRouter.post("/initiate", guestAuth, initiatePayment);
paymentRouter.post("/verify", guestAuth, verifyPayment);
paymentRouter.get("/redirect", guestAuth, paymentRedirect);
paymentRouter.get("/by-order/:orderId", guestAuth, getPaymentByOrder);

// Simulated checkout — a browser-rendered stand-in page (see paymentController),
// not an authenticated API call, same as /redirect above.
paymentRouter.get("/simulate/:reference", renderSimulatedCheckout);
paymentRouter.post("/simulate/:reference/complete", completeSimulatedPayment);

export default paymentRouter;
