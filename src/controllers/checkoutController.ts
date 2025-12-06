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

  let authUserId = req.auth?.id; // Registered user
  let sessionGuestId = req.auth?.sessionId || req.body.sessionId; // Guest session

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

  /** ------------------ 1. Resolve or Create User ------------------ */
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
          password: safePassword,
          confirmPassword: safePassword,
          gender,
          dateOfBirth,
          homeAddress,
          city,
          state,
          lga,
          preferences: preferences || {},
          isAnonymous: false, // guest becomes registered
          roles: ["User"],
          verified: false,
        });

    // Update authUserId now that we have a registered user
    authUserId = user.id.toString();
  }

  /** ------------------ 2. Fetch Cart ------------------ */
  let cart;

  // First check if the user has an existing cart
  if (authUserId) cart = await Cart.findOne({ userId: authUserId });

  // Fallback to guest session cart
  if (!cart && sessionGuestId) cart = await Cart.findOne({ sessionId: sessionGuestId });

  if (!cart || cart.items.length === 0) throw new Error("Cart is empty");

  /** ------------------ 3. Merge Guest Cart (if any) ------------------ */
  if (cart.sessionId && authUserId) {
    console.log("🛒 Merging guest cart to authenticated user ID:", authUserId);
    cart.userId = new Types.ObjectId(authUserId);
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
      await user.save();
      console.log("Partner user created ->", user.partnerId);
    } catch (err: any) {
      console.error("[Checkout] Partner user sync failed:", err.response?.data || err.message);
      throw new Error("Failed to sync user with partner system");
    }
  }

  /** ------------------ 5. Prepare Partner Order ------------------ */
  const productLookup = new Map();
  for (const item of cart.items) {
    const product = await Product.findById(item.drugId);
    if (!product) throw new Error(`Product not found: ${item.drugId}`);
    if (!product.partnerProductId)
      throw new Error(`Partner product ID missing for ${product.name} (${item.drugId})`);
    productLookup.set(item.drugId.toString(), product);
  }

  const partnerItems = cart.items.map((item) => {
    const product = productLookup.get(item.drugId.toString())!;
    return {
      drugId: product.partnerProductId,
      quantity: item.quantity,
      dosage: item.dosage || "",
      special_instructions: item.specialInstructions || "",
    };
  });

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

  /** ------------------ 6. Save Local Order ------------------ */
  const localOrder = await Order.create({
    orderNumber: uuidv4(),
    userId: authUserId,
    partnerOrderId: partnerOrder?.orderId,
    isThirdPartyOrder: true,
    platform: "PlanAmWell",
    items: cart.items.map((i) => {
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

  /** ------------------ 7. Clear Cart ------------------ */
  await Cart.deleteOne({ _id: cart._id });

  /** ------------------ 8. Respond ------------------ */
  res.status(201).json({
    success: true,
    message: "Checkout successful",
    localOrder,
    partnerOrder,
    user: {
      id: user._id,
      isAnonymous: user.isAnonymous,
      partnerId: user.partnerId,
    },
  });
});
