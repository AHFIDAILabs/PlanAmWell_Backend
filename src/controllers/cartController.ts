// controllers/cartController.ts
import { Request, Response } from "express";
import asyncHandler from "../middleware/asyncHandler";
import axios from "axios";
import { Cart, ICartItem } from "../models/cart";
import { Types } from "mongoose";
import { User } from "../models/user";
import { Product } from "../models/product";

const PARTNER_API_URL = process.env.PARTNER_API_URL || "";

// ------------------ Helper: determine owner ------------------
const getOwnerQuery = (req: Request) => {
  if (req.auth?.id) return { userId: req.auth.id }; // logged-in user
  if (req.auth?.sessionId) return { sessionId: req.auth.sessionId }; // guest session
  const fallbackSessionId = req.query.sessionId || req.body.sessionId;
  if (fallbackSessionId) return { sessionId: fallbackSessionId };
  throw new Error("No userId or sessionId provided to identify cart owner.");
};

// ------------------ Helper: map cart item for partner API ------------------
const mapCartItemForPartner = async (item: ICartItem) => {
  const product = await Product.findById(item.drugId);
  if (!product) throw new Error(`Product not found for drugId: ${item.drugId}`);
  if (!product.partnerProductId)
    throw new Error(
      `partnerProductId missing for product: ${product.name} (${item.drugId})`,
    );

  return {
    drug_id: product.partnerProductId, // partner UUID, not your local _id
    quantity: item.quantity,
    dosage: item.dosage || "",
    special_instructions: item.specialInstructions || "",
  };
};

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
    items.forEach((item) => {
      if (!item.drugId)
        throw new Error("All items must have drug_id (partner UUID)");
      const index = cart!.items.findIndex((i) => i.drugId === item.drugId);
      if (index > -1) {
        cart!.items[index].quantity += item.quantity;
      } else {
        cart!.items.push({ ...item });
      }
    });
  }

  cart.totalItems = cart.items.reduce((sum, i) => sum + i.quantity, 0);
  cart.totalPrice = cart.items.reduce(
    (sum, i) => sum + (i.price || 0) * i.quantity,
    0,
  );

  await cart.save();

  // Sync with partner API if userId exists
  let partnerCart;
  if (ownerQuery.userId) {
    try {
      const user = await User.findById(ownerQuery.userId);
      if (!user) throw new Error("User not found");

      // ── Step 1: Ensure user has a partnerId (UUID) ──────────────────────
      // If the user doesn't have a partnerId yet, register them with the
      // partner system first — same logic as checkoutController.syncUserWithPartner
      if (!user.partnerId) {
        try {
          // Check if they already exist in partner DB by email
          if (user.email) {
            const searchRes = await axios.get(
              `${PARTNER_API_URL}/v1/PlanAmWell/accounts/search?email=${encodeURIComponent(user.email)}`,
            );
            if (searchRes.data?.user?.id) {
              user.partnerId = searchRes.data.user.id;
              await user.save();
            }
          }

          // Still no partnerId — create the account in partner DB
          if (!user.partnerId) {
            const safePassword = Math.random().toString(36).slice(-10);
            const createRes = await axios.post(
              `${PARTNER_API_URL}/v1/PlanAmWell/accounts`,
              {
                name: user.name,
                email: user.email,
                phone: user.phone,
                password: safePassword,
                confirmPassword: safePassword,
                gender: user.gender || "male",
                dateOfBirth: user.dateOfBirth,
                homeAddress: user.homeAddress,
                state: user.state,
                lga: user.lga,
                role: "CLIENT",
                origin: "PlanAmWell",
                isGuest: false,
              },
            );
            user.partnerId = createRes.data.user.id;
            await user.save();
          }
        } catch (syncErr: any) {
          // If 409 conflict (already exists), try searching again
          if (syncErr.response?.status === 409 && user.email) {
            const retryRes = await axios.get(
              `${PARTNER_API_URL}/v1/PlanAmWell/accounts/search?email=${encodeURIComponent(user.email)}`,
            );
            if (retryRes.data?.user?.id) {
              user.partnerId = retryRes.data.user.id;
              await user.save();
            }
          } else {
            console.warn(
              "[CartController] Could not sync user with partner:",
              syncErr.response?.data || syncErr.message,
            );
          }
        }
      }

      // ── Step 2: Now sync the cart using the UUID partnerId ──────────────
      if (!user.partnerId) {
        console.warn(
          "[CartController] Still no partnerId after sync attempt, skipping partner cart.",
        );
      } else {
        // Resolve partnerProductId for every item before sending
        const partnerItems = await Promise.all(
          cart.items.map(mapCartItemForPartner),
        );

        const payload = {
          userId: user.partnerId, // ✅ partner UUID
          items: partnerItems, // ✅ each drug_id is partner UUID
        };

        const partnerResponse = await axios.post(
          `${PARTNER_API_URL}/v1/PlanAmWell/cart`,
          payload,
        );

        partnerCart = partnerResponse.data.updatedCart;

        if (partnerCart) {
          cart.partnerCartId = partnerCart.id;
          cart.isAbandoned = partnerCart.isAbandoned;
          cart.totalItems = partnerCart.totalItems;
          cart.totalPrice = parseFloat(partnerCart.totalPrice);
          await cart.save();
        }
      }
    } catch (err: any) {
      console.error(
        "[CartController] partner API addToCart failed:",
        err.response?.data || err.message,
      );
    }
  }

  res.status(201).json({ success: true, localCart: cart, partnerCart });
});

// ------------------ GET CART ------------------
export const getCart = asyncHandler(async (req: Request, res: Response) => {
  const ownerQuery = getOwnerQuery(req);
  const cart = await Cart.findOne(ownerQuery);
  if (!cart)
    return res.status(404).json({ success: false, message: "Cart not found" });
  res.status(200).json({ success: true, data: cart });
});

// ------------------ CLEAR CART ------------------
export const clearCart = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.auth?.id;
  const sessionId = req.auth?.sessionId;

  if (!userId && !sessionId) {
    return res.status(401).json({
      message: "Unauthorized: login or active session required to clear cart.",
    });
  }

  const cartQuery: any = { $or: [] };

  if (userId) cartQuery.$or.push({ userId: new Types.ObjectId(userId) }); // ✅ convert to ObjectId
  if (sessionId) cartQuery.$or.push({ sessionId });

  if (cartQuery.$or.length === 0) {
    return res
      .status(400)
      .json({ success: false, message: "No cart identifier found" });
  }

  const cart = await Cart.findOne(cartQuery);

  if (!cart) {
    return res
      .status(404)
      .json({ success: false, message: "No cart found to clear" });
  }

  await Cart.deleteMany(cartQuery);

  return res.status(200).json({
    success: true,
    message: "Cart cleared successfully",
  });
});

// ------------------ UPDATE CART ITEM ------------------
export const updateCartItem = asyncHandler(
  async (req: Request, res: Response) => {
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
    if (specialInstructions !== undefined)
      cart.items[itemIndex].specialInstructions = specialInstructions;

    cart.totalItems = cart.items.reduce((sum, i) => sum + i.quantity, 0);
    cart.totalPrice = cart.items.reduce(
      (sum, i) => sum + (i.price || 0) * i.quantity,
      0,
    );

    await cart.save();
    res.status(200).json({ success: true, data: cart });
  },
);

// ------------------ REMOVE ITEM FROM CART ------------------
export const removeCartItem = asyncHandler(
  async (req: Request, res: Response) => {
    const { drugId } = req.body;
    if (!drugId) throw new Error("drugId is required");

    const ownerQuery = getOwnerQuery(req);
    const cart = await Cart.findOne(ownerQuery);
    if (!cart) throw new Error("Cart not found");

    cart.items = cart.items.filter((i) => i.drugId !== drugId);
    cart.totalItems = cart.items.reduce((sum, i) => sum + i.quantity, 0);
    cart.totalPrice = cart.items.reduce(
      (sum, i) => sum + (i.price || 0) * i.quantity,
      0,
    );

    await cart.save();
    res.status(200).json({ success: true, data: cart });
  },
);
