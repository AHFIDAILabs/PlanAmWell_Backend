import { Router } from "express";   
import { checkout } from "../controllers/checkoutController"; 
import { guestAuth, verifyToken } from "../middleware/auth";

const checkoutRouter = Router();

// Public - anyone can initiate checkout
checkoutRouter.post("/", guestAuth, verifyToken,  checkout);

export default checkoutRouter;