// controllers/checkoutController.ts
import { Request, Response } from "express";
import asyncHandler from "../middleware/asyncHandler";
import axios from "axios";
import { User } from "../models/user";
import { Cart, ICartItem } from "../models/cart";
import { Order } from "../models/order";
import { Product } from "../models/product";
import { v4 as uuidv4 } from "uuid";
import { Types } from "mongoose";

const PARTNER_API_URL = process.env.PARTNER_API_URL || "";
const PARTNER_PREFIX = "/v1/PlanAmWell";

/** ------------------ CHECKOUT ------------------ */
export const checkout = asyncHandler(async (req: Request, res: Response) => {
  console.log("--- CHECKOUT REQUEST RECEIVED ---");

  const authUserId = req.auth?.id;
  let sessionGuestId = req.auth?.sessionId || req.body.sessionId;

  // Identify cart owner
  const cartQuery = authUserId
    ? { userId: authUserId }
    : sessionGuestId
    ? { sessionId: sessionGuestId }
    : null;

  if (!cartQuery) throw new Error("Cannot identify cart owner for checkout.");

  const {
    name,
    phone,
    email,
    password,
    confirmPassword,
    gender,
    dateOfBirth,
    homeAddress,
    city,
    state,
    lga,
    preferences,
  } = req.body;

  const safePassword =
    password && password.length <= 25 ? password : Math.random().toString(36).slice(-10);

  /** ------------------ 1. Resolve user ------------------ */
  let user;

  if (authUserId) {
    user = await User.findById(authUserId);
    if (!user) throw new Error("Authenticated user not found");
  } else {
    if (!name || !phone) throw new Error("Guest checkout requires name & phone");

    const existingUser = email ? await User.findOne({ email }) : null;

    user = existingUser
      ? existingUser
      : await User.create({
          name,
          phone,
          email,
          password: password || safePassword,
          confirmPassword: confirmPassword || safePassword,
          gender,
          dateOfBirth,
          homeAddress,
          city,
          state,
          lga,
          preferences: preferences || {},
          isAnonymous: true,
          roles: ["User"],
          verified: false,
        });
  }

  /** ------------------ 2. Fetch cart ------------------ */
 let cart;
  if (authUserId) {
    // Try to find by authenticated user ID
    cart = await Cart.findOne({ userId: authUserId });
  } 
  
  if (!cart && sessionGuestId) {
    // Fallback: If no cart found for the user, check if there is a pending guest cart
    cart = await Cart.findOne({ sessionId: sessionGuestId });
  }

  if (!cart || cart.items.length === 0) throw new Error("Cart is empty"); // Check if still empty

  /** ------------------ 3. Merge guest → user (MUST BE RE-EVALUATED) ------------------ */
  // This logic should now handle merging a found guest cart to the authenticated user ID.
  // This runs if we found a cart using the sessionId AND we know who the registered user is.
  if (authUserId && cart.sessionId) { 
    console.log("🛒 Merging guest cart to authenticated user ID:", authUserId);
    cart.userId = new Types.ObjectId(authUserId); // Use new Types.ObjectId for Mongoose
    cart.sessionId = undefined;
    cart.isAbandoned = false;
    await cart.save();
  }

  /** ------------------ 4. Sync User with Partner ------------------ */
  if (!user.partnerId) {
    try {
      const partnerRes = await axios.post(`${PARTNER_API_URL}${PARTNER_PREFIX}/accounts`, {
        name: user.name,
        email: user.email || `guest-${uuidv4()}@planamwell.local`,
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
        isGuest: user.isAnonymous || false,
      });

      user.partnerId = partnerRes.data.user.id;
      console.log("Partner user created ->", user.partnerId);
      await user.save();
    } catch (err: any) {
      console.error("[Checkout] Partner user sync failed:", err.response?.data || err.message);
      throw new Error("Failed to sync user with partner system");
    }
  }

  /** ------------------ 5. Fetch all products once ------------------ */
  const productLookup = new Map();
  for (const item of cart.items) {
    const product = await Product.findById(item.drugId);
    if (!product) {
      throw new Error(`Product not found: ${item.drugId}`);
    }
    if (!product.partnerProductId) {
      throw new Error(`Partner product ID missing for ${product.name} (${item.drugId})`);
    }
    productLookup.set(item.drugId.toString(), product);
  }

  /** ------------------ 6. Prepare order items for partner ------------------ */
  const partnerItems = cart.items.map(item => {
    const product = productLookup.get(item.drugId.toString())!;
    return {
      drugId: product.partnerProductId,
      quantity: item.quantity,
      dosage: item.dosage || "",
      special_instructions: item.specialInstructions || "",
    };
  });

  /** ------------------ 7. Create Partner Order ------------------ */
  let partnerOrder;
  try {
    const payload = {
      userId: user.partnerId,
      telephone: user.phone,
      address: user.homeAddress || user.preferences?.address || "",
      state: user.state || user.preferences?.state || "",
      lga: user.lga || user.preferences?.lga || "",
      deliveryMethod: "home",
      isHomeAddress: true,
      isThirdPartyOrder: true,
      discount: 0,
      platform: "PlanAmWell",
      items: partnerItems,
    };

    console.log("[Checkout] Partner order payload:", payload);
    const orderRes = await axios.post(`${PARTNER_API_URL}${PARTNER_PREFIX}/orders`, payload);
    partnerOrder = orderRes.data.data;
  } catch (err: any) {
    console.error("[Checkout] Failed to create partner order:", err.response?.data || err.message);
    throw new Error("Partner order creation failed");
  }

  /** ------------------ 8. Save Local Order Snapshot ------------------ */
  const localOrder = await Order.create({
    orderNumber: uuidv4(),
    userId: user.isAnonymous ? undefined : user._id,
    sessionId: user.isAnonymous ? sessionGuestId : undefined,
    partnerOrderId: partnerOrder?.orderId,
    isThirdPartyOrder: true,
    platform: "PlanAmWell",
    items: cart.items.map(i => {
      const product = productLookup.get(i.drugId.toString())!;
      return {
        productId: product._id,
        name: product.name,
        sku: product.sku,
        qty: i.quantity,
        price: product.price || i.price || 0,
        dosage: i.dosage,
        specialInstructions: i.specialInstructions,
      };
    }),
    subtotal: cart.totalPrice,
    total: cart.totalPrice,
    paymentStatus: "pending",
    shippingAddress: {
      name: user.name,
      phone: user.phone,
      addressLine: user.homeAddress || user.preferences?.address,
      city: user.city || user.preferences?.city,
      state: user.state || user.preferences?.state,
    },
  });

  /** ------------------ 9. Clear Cart ------------------ */
  await Cart.deleteOne({ _id: cart._id });

  /** ------------------ 10. Response ------------------ */
  res.status(201).json({
    success: true,
    message: "Checkout successful",
    localOrder,
    partnerOrder,
    user: {
      id: user._id,
      isAnonymous: user.isAnonymous,
      sessionId: user.isAnonymous ? sessionGuestId : undefined,
      partnerId: user.partnerId,
    },
  });
});