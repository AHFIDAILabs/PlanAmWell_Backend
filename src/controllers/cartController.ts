import { Request, Response } from "express";
import asyncHandler from "../middleware/asyncHandler";
import axios from "axios";
import { Cart, ICartItem } from "../models/cart";
import { Types } from "mongoose";
import { User } from "../models/user";
import { Product } from "../models/product";

const PARTNER_API_URL = process.env.PARTNER_API_URL || "";
const PARTNER_PREFIX  = "/v1/PlanAmWell";

// ── Resolve local drugIds → partner payload ──────────────────────────────────
const resolvePartnerItems = async (items: ICartItem[]) => {
  return Promise.all(
    items.map(async (item) => {
      const product = await Product.findById(item.drugId);
      if (!product)
        throw new Error(`Product not found: ${item.drugId}`);
      if (!product.partnerProductId)
        throw new Error(`partnerProductId missing for: ${product.name}`);
      return {
        drug_id:              product.partnerProductId, // ✅ partner UUID
        quantity:             item.quantity,
        dosage:               item.dosage || "",
        special_instructions: item.specialInstructions || "",
      };
    })
  );
};

// ── Identify cart owner ──────────────────────────────────────────────────────
const getOwnerQuery = (req: Request) => {
  if (req.auth?.id)        return { userId: req.auth.id };
  if (req.auth?.sessionId) return { sessionId: req.auth.sessionId };
  const fallback = req.query.sessionId || req.body.sessionId;
  if (fallback)            return { sessionId: fallback as string };
  throw new Error("No userId or sessionId provided to identify cart owner.");
};

// ── Sync partner user (ensure partnerId exists) ──────────────────────────────
const ensurePartnerUser = async (user: any): Promise<string | null> => {
  if (user.partnerId) return user.partnerId;

  try {
    // Check by email first
    if (user.email) {
      const searchRes = await axios.get(
        `${PARTNER_API_URL}${PARTNER_PREFIX}/accounts/search?email=${encodeURIComponent(user.email)}`
      );
      if (searchRes.data?.user?.id) {
        user.partnerId = searchRes.data.user.id;
        await user.save();
        return user.partnerId;
      }
    }

    // Create in partner system
    const safePassword = Math.random().toString(36).slice(-10);
    const createRes = await axios.post(`${PARTNER_API_URL}${PARTNER_PREFIX}/accounts`, {
      name:            user.name,
      email:           user.email,
      phone:           user.phone,
      password:        safePassword,
      confirmPassword: safePassword,
      gender:          user.gender || "male",
      dateOfBirth:     user.dateOfBirth,
      homeAddress:     user.homeAddress,
      state:           user.state,
      lga:             user.lga,
      role:            "CLIENT",
      origin:          "PlanAmWell",
      isGuest:         false,
    });
    user.partnerId = createRes.data.user.id;
    await user.save();
    return user.partnerId;
  } catch (err: any) {
    // 409 = already exists, retry search
    if (err.response?.status === 409 && user.email) {
      try {
        const retryRes = await axios.get(
          `${PARTNER_API_URL}${PARTNER_PREFIX}/accounts/search?email=${encodeURIComponent(user.email)}`
        );
        if (retryRes.data?.user?.id) {
          user.partnerId = retryRes.data.user.id;
          await user.save();
          return user.partnerId;
        }
      } catch (_) {}
    }
    console.warn("[CartController] Could not sync user with partner:", err.response?.data || err.message);
    return null;
  }
};

// ── Sync cart to partner (fire-and-forget, never throws) ────────────────────
const syncCartToPartner = async (cart: any, partnerId: string) => {
  try {
    const partnerItems = await resolvePartnerItems(cart.items);
    const response = await axios.post(`${PARTNER_API_URL}${PARTNER_PREFIX}/cart`, {
      userId: partnerId,   // ✅ partner UUID
      items:  partnerItems,
    });

    const partnerCart = response.data.updatedCart;
    if (partnerCart) {
      await cart.updateOne({
        partnerCartId: partnerCart.id,
        isAbandoned:   partnerCart.isAbandoned,
        totalItems:    partnerCart.totalItems,
        totalPrice:    parseFloat(partnerCart.totalPrice),
      });
    }
    console.log("[CartController] Partner cart synced ✅");
  } catch (err: any) {
    console.error("[CartController] Partner cart sync failed:", err.response?.data || err.message);
  }
};

// ── ADD ITEMS TO CART ────────────────────────────────────────────────────────
export const addToCart = asyncHandler(async (req: Request, res: Response) => {
  const { items } = req.body as { items: ICartItem[] };
  if (!items?.length) {
    res.status(400);
    throw new Error("Items are required");
  }

  // Validate all drugIds exist locally before touching the cart
  for (const item of items) {
    if (!item.drugId) throw new Error("Each item must have a drugId");
    const exists = await Product.exists({ _id: item.drugId });
    if (!exists) throw new Error(`Product not found: ${item.drugId}`);
  }

  const ownerQuery = getOwnerQuery(req);
  let cart = await Cart.findOne(ownerQuery);

  if (!cart) {
    cart = new Cart({ ...ownerQuery, items, totalItems: 0, totalPrice: 0 });
  } else {
    for (const item of items) {
      const idx = cart.items.findIndex((i) => i.drugId === item.drugId);
      if (idx > -1) {
        cart.items[idx].quantity += item.quantity;
      } else {
        cart.items.push({ ...item });
      }
    }
  }

  cart.totalItems = cart.items.reduce((s, i) => s + i.quantity, 0);
  cart.totalPrice = cart.items.reduce((s, i) => s + (i.price || 0) * i.quantity, 0);
  await cart.save();

  // Partner sync — only for logged-in users (guests sync at checkout)
  if (ownerQuery.userId) {
    const user = await User.findById(ownerQuery.userId);
    if (user) {
      const partnerId = await ensurePartnerUser(user);
      if (partnerId) await syncCartToPartner(cart, partnerId);
    }
  }

  res.status(201).json({ success: true, data: cart });
});

// ── GET CART ─────────────────────────────────────────────────────────────────
export const getCart = asyncHandler(async (req: Request, res: Response) => {
  const ownerQuery = getOwnerQuery(req);
  const cart = await Cart.findOne(ownerQuery);
  if (!cart)
    return res.status(404).json({ success: false, message: "Cart not found" });
  res.status(200).json({ success: true, data: cart });
});

// ── CLEAR CART ───────────────────────────────────────────────────────────────
export const clearCart = asyncHandler(async (req: Request, res: Response) => {
  const userId    = req.auth?.id;
  const sessionId = req.auth?.sessionId;

  if (!userId && !sessionId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const cartQuery: any = { $or: [] };
  if (userId)    cartQuery.$or.push({ userId: new Types.ObjectId(userId) });
  if (sessionId) cartQuery.$or.push({ sessionId });

  const cart = await Cart.findOne(cartQuery);
  if (!cart)
    return res.status(404).json({ success: false, message: "No cart found to clear" });

  await Cart.deleteMany(cartQuery);
  return res.status(200).json({ success: true, message: "Cart cleared successfully" });
});

// ── UPDATE CART ITEM ─────────────────────────────────────────────────────────
export const updateCartItem = asyncHandler(async (req: Request, res: Response) => {
  const { drugId, quantity, dosage, specialInstructions } = req.body;
  if (!drugId || quantity == null) {
    res.status(400);
    throw new Error("drugId and quantity are required");
  }

  const ownerQuery = getOwnerQuery(req);
  const cart = await Cart.findOne(ownerQuery);
  if (!cart) throw new Error("Cart not found");

  const idx = cart.items.findIndex((i) => i.drugId === drugId);
  if (idx === -1) throw new Error("Item not found in cart");

  cart.items[idx].quantity = quantity;
  if (dosage !== undefined)               cart.items[idx].dosage = dosage;
  if (specialInstructions !== undefined)  cart.items[idx].specialInstructions = specialInstructions;

  cart.totalItems = cart.items.reduce((s, i) => s + i.quantity, 0);
  cart.totalPrice = cart.items.reduce((s, i) => s + (i.price || 0) * i.quantity, 0);
  await cart.save();

  res.status(200).json({ success: true, data: cart });
});

// ── REMOVE ITEM FROM CART ────────────────────────────────────────────────────
export const removeCartItem = asyncHandler(async (req: Request, res: Response) => {
  const { drugId } = req.body;
  if (!drugId) throw new Error("drugId is required");

  const ownerQuery = getOwnerQuery(req);
  const cart = await Cart.findOne(ownerQuery);
  if (!cart) throw new Error("Cart not found");

  cart.items = cart.items.filter((i) => i.drugId !== drugId);
  cart.totalItems = cart.items.reduce((s, i) => s + i.quantity, 0);
  cart.totalPrice = cart.items.reduce((s, i) => s + (i.price || 0) * i.quantity, 0);
  await cart.save();

  res.status(200).json({ success: true, data: cart });
});