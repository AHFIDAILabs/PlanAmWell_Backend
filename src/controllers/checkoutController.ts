// controllers/checkoutController.ts - COMPREHENSIVE FIX
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

/** 
 * ✅ HELPER: Check if user exists in Partner DB and get their ID
 */
async function getPartnerUserId(email: string): Promise<string | null> {
  try {
    const response = await axios.get(
      `${PARTNER_API_URL}${PARTNER_PREFIX}/accounts/search?email=${encodeURIComponent(email)}`
    );
    
    if (response.data?.user?.id) {
      console.log(`✅ Found existing partner user for ${email}:`, response.data.user.id);
      return response.data.user.id;
    }
    
    return null;
  } catch (err: any) {
    if (err.response?.status === 404) {
      console.log(`ℹ️ No existing partner user found for ${email}`);
      return null;
    }
    
    console.warn('[getPartnerUserId] Error checking partner user:', err.message);
    return null;
  }
}

/** 
 * ✅ HELPER: Sync or create user in Partner DB
 */
async function syncUserWithPartner(user: any, password: string) {
  if (user.partnerId) {
    console.log('✅ User already has partnerId:', user.partnerId);
    return user.partnerId;
  }

  if (user.email) {
    const existingPartnerId = await getPartnerUserId(user.email);
    if (existingPartnerId) {
      user.partnerId = existingPartnerId;
      await user.save();
      return existingPartnerId;
    }
  }

  try {
    const partnerRes = await axios.post(`${PARTNER_API_URL}${PARTNER_PREFIX}/accounts`, {
      name: user.name,
      email: user.email || `guest-${uuidv4()}@planamwell.local`,
      phone: user.phone,
      password: password,
      confirmPassword: password,
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
    console.log('✅ New partner user created:', user.partnerId);
    return user.partnerId;
  } catch (err: any) {
    if (err.response?.status === 409 || err.response?.data?.message?.includes('already exists')) {
      console.log('⚠️ Partner user already exists, attempting to fetch...');
      
      if (user.email) {
        const existingId = await getPartnerUserId(user.email);
        if (existingId) {
          user.partnerId = existingId;
          await user.save();
          return existingId;
        }
      }
    }
    
    console.error('[syncUserWithPartner] Failed:', err.response?.data || err.message);
    throw new Error('Failed to sync user with partner system');
  }
}

/** ------------------ CHECKOUT ------------------ */
export const checkout = asyncHandler(async (req: Request, res: Response) => {
  console.log("--- CHECKOUT REQUEST RECEIVED ---");
  console.log("Request body:", JSON.stringify(req.body, null, 2));

  let authUserId = req.auth?.id;
  let sessionGuestId = req.auth?.sessionId || req.body.sessionId;

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

  // ✅ Log what we received
  console.log("📥 Checkout data received:", {
    name,
    phone,
    email,
    hasPassword: !!password,
    gender,
    dateOfBirth,
    homeAddress,
    city,
    state,
    lga,
    hasPreferences: !!preferences,
    authUserId,
    sessionGuestId,
  });

  const safePassword =
    password && password.length <= 25 ? password : Math.random().toString(36).slice(-10);

  /** ------------------ 1. Resolve or Create User ------------------ */
  let user;

  if (authUserId) {
    user = await User.findById(authUserId);
    if (!user) throw new Error("Authenticated user not found");
    
    console.log("📝 Found authenticated user, updating fields...");
    
    // ✅ Update user's fields if provided
    let needsUpdate = false;
    
    if (name && name !== user.name) {
      user.name = name.trim();
      needsUpdate = true;
    }
    if (phone && phone !== user.phone) {
      user.phone = phone.trim();
      needsUpdate = true;
    }
    if (homeAddress && homeAddress !== user.homeAddress) {
      user.homeAddress = homeAddress.trim();
      needsUpdate = true;
    }
    if (city && city !== user.city) {
      user.city = city.trim();
      needsUpdate = true;
    }
    if (state && state !== user.state) {
      user.state = state.trim();
      needsUpdate = true;
    }
    if (lga && lga !== user.lga) {
      user.lga = lga.trim();
      needsUpdate = true;
    }
    if (gender && gender !== user.gender) {
      user.gender = gender.toLowerCase();
      needsUpdate = true;
    }
    if (dateOfBirth && dateOfBirth !== user.dateOfBirth) {
      user.dateOfBirth = dateOfBirth;
      needsUpdate = true;
    }
    
    // Update preferences
    const currentPrefs = (user.preferences || {}) as Record<string, any>;
    user.preferences = {
      ...currentPrefs,
      homeAddress: homeAddress?.trim(),
      address: homeAddress?.trim(),
      city: city?.trim(),
      state: state?.trim(),
      lga: lga?.trim(),
      ...(preferences || {}),
    };
    needsUpdate = true;
    
    if (needsUpdate) {
      await user.save();
      console.log('✅ Updated user with checkout details');
    }
  } else {
    // Guest checkout - create new user
    if (!name || !phone) throw new Error("Guest checkout requires name & phone");

    const existingUser = email ? await User.findOne({ email: email.toLowerCase().trim() }) : null;

    if (existingUser) {
      user = existingUser;
      console.log('✅ Found existing local user:', user._id);
      
      // Update existing user's details
      user.name = name.trim();
      user.phone = phone.trim();
      user.homeAddress = homeAddress?.trim();
      user.city = city?.trim();
      user.state = state?.trim();
      user.lga = lga?.trim();
      user.gender = gender?.toLowerCase();
      user.dateOfBirth = dateOfBirth;
      user.preferences = {
        ...(user.preferences || {}),
        homeAddress: homeAddress?.trim(),
        address: homeAddress?.trim(),
        city: city?.trim(),
        state: state?.trim(),
        lga: lga?.trim(),
        ...(preferences || {}),
      };
      user.isAnonymous = false;
      
      await user.save();
      console.log('✅ Updated existing user with checkout details');
    } else {
      // Check partner DB first
      let existingPartnerId: string | null = null;
      if (email) {
        existingPartnerId = await getPartnerUserId(email);
      }

      // Create new user with ALL fields
      user = await User.create({
        name: name?.trim(),
        phone: phone?.trim(),
        email: email?.trim().toLowerCase(),
        password: safePassword,
        gender: gender?.toLowerCase(),
        dateOfBirth: dateOfBirth,
        homeAddress: homeAddress?.trim(),
        city: city?.trim(),
        state: state?.trim(),
        lga: lga?.trim(),
        preferences: {
          homeAddress: homeAddress?.trim(),
          address: homeAddress?.trim(),
          city: city?.trim(),
          state: state?.trim(),
          lga: lga?.trim(),
          ...(preferences || {}),
        },
        isAnonymous: false,
        roles: ["User"],
        verified: false,
        partnerId: existingPartnerId || undefined,
      });

      console.log('✅ Created new local user with full details:', {
        id: user._id,
        name: user.name,
        email: user.email,
        homeAddress: user.homeAddress,
        city: user.city,
        state: user.state,
        lga: user.lga,
        gender: user.gender,
        dateOfBirth: user.dateOfBirth,
        hasPreferences: !!user.preferences,
        partnerId: user.partnerId,
      });
    }

    authUserId = user.id.toString();
  }

  /** ------------------ 2. Fetch Cart ------------------ */
  let cart;

  if (authUserId) cart = await Cart.findOne({ userId: authUserId });
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
  const partnerId = await syncUserWithPartner(user, safePassword);
  if (!partnerId) {
    throw new Error('Failed to get partner user ID');
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
      userId: partnerId,
      telephone: user.phone,
      address: user.homeAddress || (user.preferences as any)?.address || "",
      state: user.state || (user.preferences as any)?.state || "",
      lga: user.lga || (user.preferences as any)?.lga || "",
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
      addressLine: user.homeAddress || (user.preferences as any)?.address,
      city: user.city || (user.preferences as any)?.city,
      state: user.state || (user.preferences as any)?.state,
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