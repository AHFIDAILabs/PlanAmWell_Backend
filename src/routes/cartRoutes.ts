// cartRouter.ts (RECTIFIED)

import { Router } from "express";
import { getCart, addToCart, updateCartItem, removeCartItem, clearCart } from "../controllers/cartController";
import { verifyToken, authorize, guestAuth } from "../middleware/auth"; // Ensure guestAuth is imported
const cartRouter = Router();

/*
The strategy is to use guestAuth on ALL paths to populate req.auth.
Then, inside the specific controller (like clearCart), you enforce authorization.
*/

// Cart Routes - All paths must run guestAuth to decode tokens/sessions
cartRouter.get("/", guestAuth, getCart);
cartRouter.post("/", guestAuth, addToCart);
cartRouter.put("/update", guestAuth, updateCartItem);
cartRouter.delete("/:itemId", guestAuth, removeCartItem);

// 🛑 FIX: Use guestAuth here. The controller must then check req.auth.id
// If you want to enforce that ONLY logged-in users can clear the cart, 
// you would use verifyToken inside the controller logic itself.
// However, since clearCart is often used by the client after guest conversion,
// keeping it open but checking auth inside the controller is safer.
cartRouter.delete("/", guestAuth, clearCart); 

export default cartRouter;