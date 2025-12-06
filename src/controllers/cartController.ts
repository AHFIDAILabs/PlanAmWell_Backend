// controllers/cartController.ts
import { Request, Response } from "express";
import asyncHandler from "../middleware/asyncHandler";
import axios from "axios";
import { Cart, ICartItem } from "../models/cart";

const PARTNER_API_URL = process.env.PARTNER_API_URL || "";

// ------------------ Helper: determine owner ------------------
const getOwnerQuery = (req: Request) => {
  if (req.auth?.id) return { userId: req.auth.id };       // logged-in user
  if (req.auth?.sessionId) return { sessionId: req.auth.sessionId }; // guest session
  const fallbackSessionId = req.query.sessionId || req.body.sessionId;
  if (fallbackSessionId) return { sessionId: fallbackSessionId };
  throw new Error("No userId or sessionId provided to identify cart owner.");
};

// ------------------ Helper: map cart item for partner API ------------------
const mapCartItemForPartner = (item: ICartItem) => ({
  drug_id: item.drugId,              // Must be partner UUID
  quantity: item.quantity,
  dosage: item.dosage || "",
  special_instructions: item.specialInstructions || "",
});

// ------------------ ADD ITEMS TO CART ------------------
export const addToCart = asyncHandler(async (req: Request, res: Response) => {
  const { items } = req.body as { items: ICartItem[] };
  if (!items || items.length === 0) {
    res.status(400);
    throw new Error("Items are required");
  }

  const ownerQuery = getOwnerQuery(req);
  let cart = await Cart.findOne(ownerQuery);

  if (!cart) {
    cart = new Cart({ ...ownerQuery, items, totalItems: 0, totalPrice: 0 });
  } else {
    // Merge items
    items.forEach((item) => {
      if (!item.drugId) throw new Error("All items must have drugId (partner UUID)");
      const index = cart!.items.findIndex((i) => i.drugId === item.drugId);
      if (index > -1) {
        cart!.items[index].quantity += item.quantity;
      } else {
        cart!.items.push({ ...item });
      }
    });
  }

  // Recalculate totals
  cart.totalItems = cart.items.reduce((sum, i) => sum + i.quantity, 0);
  cart.totalPrice = cart.items.reduce((sum, i) => sum + (i.price || 0) * i.quantity, 0);

  await cart.save();

  // Sync with partner API if userId exists
  let partnerCart;
  if (ownerQuery.userId) {
    try {
      const payload = {
        userId: ownerQuery.userId,
        items: cart.items.map(mapCartItemForPartner),
      };
      console.log("[CartController] partner addToCart payload:", JSON.stringify(payload));
      const partnerResponse = await axios.post(`${PARTNER_API_URL}/cart`, payload);
      partnerCart = partnerResponse.data.updatedCart;

      cart.partnerCartId = partnerCart.id;
      cart.isAbandoned = partnerCart.isAbandoned;
      cart.totalItems = partnerCart.totalItems;
      cart.totalPrice = parseFloat(partnerCart.totalPrice);
      await cart.save();
    } catch (err: any) {
      console.error("[CartController] partner API addToCart failed:", err.response?.data || err.message);
    }
  }

  res.status(201).json({ success: true, localCart: cart, partnerCart });
});

// ------------------ GET CART ------------------
export const getCart = asyncHandler(async (req: Request, res: Response) => {
  const ownerQuery = getOwnerQuery(req);
  const cart = await Cart.findOne(ownerQuery);
  if (!cart) return res.status(404).json({ success: false, message: "Cart not found" });
  res.status(200).json({ success: true, data: cart });
});

// ------------------ CLEAR CART ------------------
export const clearCart = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.auth?.id;
  const sessionId = req.auth?.sessionId;

  // Ensure at least one identifier exists
  if (!userId && !sessionId) {
    return res
      .status(401)
      .json({ message: "Unauthorized: login or active session required to clear cart." });
  }

  // Build query to find cart
  const cartQuery: any = {};
  if (userId) cartQuery.userId = userId;
  if (!userId && sessionId) cartQuery.sessionId = sessionId;

  // Attempt to find the cart first
  const cart = await Cart.findOne(cartQuery);
  if (!cart) {
    return res.status(404).json({ success: false, message: "No cart found to clear" });
  }

  await Cart.deleteOne({ _id: cart._id });
  res.status(200).json({ success: true, message: "Cart cleared" });
});


// ------------------ UPDATE CART ITEM ------------------
export const updateCartItem = asyncHandler(async (req: Request, res: Response) => {
  const { drugId, quantity, dosage, specialInstructions } = req.body;
  if (!drugId || quantity == null) {
    res.status(400);
    throw new Error("drugId and quantity are required");
  }

  const ownerQuery = getOwnerQuery(req);
  const cart = await Cart.findOne(ownerQuery);
  if (!cart) throw new Error("Cart not found");

  const itemIndex = cart.items.findIndex((i) => i.drugId === drugId);
  if (itemIndex === -1) throw new Error("Item not found in cart");

  cart.items[itemIndex].quantity = quantity;
  if (dosage !== undefined) cart.items[itemIndex].dosage = dosage;
  if (specialInstructions !== undefined) cart.items[itemIndex].specialInstructions = specialInstructions;

  cart.totalItems = cart.items.reduce((sum, i) => sum + i.quantity, 0);
  cart.totalPrice = cart.items.reduce((sum, i) => sum + (i.price || 0) * i.quantity, 0);

  await cart.save();
  res.status(200).json({ success: true, data: cart });
});

// ------------------ REMOVE ITEM FROM CART ------------------
export const removeCartItem = asyncHandler(async (req: Request, res: Response) => {
  const { drugId } = req.body;
  if (!drugId) throw new Error("drugId is required");

  const ownerQuery = getOwnerQuery(req);
  const cart = await Cart.findOne(ownerQuery);
  if (!cart) throw new Error("Cart not found");

  cart.items = cart.items.filter((i) => i.drugId !== drugId);
  cart.totalItems = cart.items.reduce((sum, i) => sum + i.quantity, 0);
  cart.totalPrice = cart.items.reduce((sum, i) => sum + (i.price || 0) * i.quantity, 0);

  await cart.save();
  res.status(200).json({ success: true, data: cart });
});
