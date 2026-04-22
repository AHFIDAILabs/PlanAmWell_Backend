
import { Router } from "express";
import { getPaymentMethods, initiatePayment,   paymentRedirect, getPaymentByOrder, verifyPayment
 } from "../controllers/paymentController";
import { guestAuth } from "../middleware/auth";

const paymentRouter = Router();

// Allow guests to access payment methods and initiate payment
paymentRouter.get("/methods", guestAuth, getPaymentMethods);
paymentRouter.post("/initiate", guestAuth, initiatePayment);
paymentRouter.post("/verify", guestAuth, verifyPayment); 
paymentRouter.get("/redirect", guestAuth, paymentRedirect);
paymentRouter.get("/by-order/:orderId", guestAuth, getPaymentByOrder);

export default paymentRouter;
