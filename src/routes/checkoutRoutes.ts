import { Router } from "express";   
import { checkout } from "../controllers/checkoutController"; 
import { guestAuth } from "../middleware/auth";

const checkoutRouter = Router();

// Public - anyone can initiate checkout
checkoutRouter.post("/", guestAuth, checkout);

export default checkoutRouter;