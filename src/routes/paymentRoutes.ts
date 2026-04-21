
import { Router } from "express";
import { getPaymentMethods, initiatePayment,   paymentRedirect,
 } from "../controllers/paymentController";
import { guestAuth } from "../middleware/auth";

const paymentRouter = Router();

// Allow guests to access payment methods and initiate payment
paymentRouter.get("/methods", guestAuth, getPaymentMethods);
paymentRouter.post("/initiate", guestAuth, initiatePayment);
paymentRouter.get("/redirect", guestAuth, paymentRedirect);

export default paymentRouter;
