import { Router } from "express";   
import { checkout, confirmOrder, getDeliveryFee } from "../controllers/checkoutController"; 
import { guestAuth, verifyToken } from "../middleware/auth";

const checkoutRouter = Router();

// Public - anyone can initiate checkout
checkoutRouter.get("/delivery-fee", getDeliveryFee); 
checkoutRouter.post("/", guestAuth, verifyToken,  checkout);
checkoutRouter.post("/confirm", guestAuth, verifyToken, confirmOrder);

export default checkoutRouter;