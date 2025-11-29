
import { Router } from "express";
import { getPaymentMethods, initiatePayment } from "../controllers/paymentController";
import { guestAuth } from "../middleware/auth";

const paymentRouter = Router();

// Allow guests to access payment methods and initiate payment
paymentRouter.get("/methods", guestAuth, getPaymentMethods);
paymentRouter.post("/initiate", guestAuth, initiatePayment);

export default paymentRouter;
