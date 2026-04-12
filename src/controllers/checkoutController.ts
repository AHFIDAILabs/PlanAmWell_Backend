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

// ── Helper: same fields required as appointment booking ──────────────────────
/**
 * Returns labels for whichever of phone / gender / dateOfBirth are missing.
 * Mirrors getMissingAppointmentFields in appointmentController exactly.
 */
function getMissingCheckoutFields(user: any): string[] {
  const required: { field: string; label: string }[] = [
    { field: "phone", label: "Phone number" },
    { field: "gender", label: "Gender" },
    { field: "dateOfBirth", label: "Date of birth" },
  ];
  return required.filter(({ field }) => !user[field]).map(({ label }) => label);
}

/**
 * ✅ HELPER: Check if user exists in Partner DB and get their ID
 */
async function getPartnerUserId(email: string): Promise<string | null> {
  try {
    const response = await axios.get(
      `${PARTNER_API_URL}${PARTNER_PREFIX}/accounts/search?email=${encodeURIComponent(email)}`,
    );
    if (response.data?.user?.id) {
      return response.data.user.id;
    }
    return null;
  } catch (err: any) {
    if (err.response?.status === 404) return null;
    console.warn(
      "[getPartnerUserId] Error checking partner user:",
      err.message,
    );
    return null;
  }
}

/**
 * ✅ HELPER: Sync or create user in Partner DB
 */
async function syncUserWithPartner(user: any, password: string) {
  if (user.partnerId) {
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
    const partnerRes = await axios.post(
      `${PARTNER_API_URL}${PARTNER_PREFIX}/accounts`,
      {
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
      },
    );

    user.partnerId = partnerRes.data.user.id;
    await user.save();
    return user.partnerId;
  } catch (err: any) {
    if (
      err.response?.status === 409 ||
      err.response?.data?.message?.includes("already exists")
    ) {
      if (user.email) {
        const existingId = await getPartnerUserId(user.email);
        if (existingId) {
          user.partnerId = existingId;
          await user.save();
          return existingId;
        }
      }
    }
    console.error(
      "[syncUserWithPartner] Failed:",
      err.response?.data || err.message,
    );
    throw new Error("Failed to sync user with partner system");
  }
}

/** ------------------ CHECKOUT ------------------ */
export const checkout = asyncHandler(async (req: Request, res: Response) => {
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

  const safePassword =
    password && password.length <= 25
      ? password
      : Math.random().toString(36).slice(-10);

  /** ------------------ 1. Resolve or Create User ------------------ */
  let user;

  if (authUserId) {
    user = await User.findById(authUserId);
    if (!user) throw new Error("Authenticated user not found");

    const effectivePhone = phone || user.phone;
    const effectiveGender = gender || user.gender;
    const effectiveDateOfBirth = dateOfBirth || user.dateOfBirth;

    const missingFields: string[] = [];
    if (!effectivePhone) missingFields.push("Phone number");
    if (!effectiveGender) missingFields.push("Gender");
    if (!effectiveDateOfBirth) missingFields.push("Date of birth");

    if (missingFields.length > 0) {
      return res.status(422).json({
        success: false,
        code: "PROFILE_INCOMPLETE",
        message: "Please complete your profile before placing an order.",
        missingFields,
      });
    }

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
    if (needsUpdate) await user.save();
  } else {
    if (!name || !phone)
      throw new Error("Guest checkout requires name & phone");

    const existingUser = email
      ? await User.findOne({ email: email.toLowerCase().trim() })
      : null;

    if (existingUser) {
      user = existingUser;
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
    } else {
      let existingPartnerId: string | null = null;
      if (email) existingPartnerId = await getPartnerUserId(email);

      user = await User.create({
        name: name?.trim(),
        phone: phone?.trim(),
        email: email?.trim().toLowerCase(),
        password: safePassword,
        gender: gender?.toLowerCase(),
        dateOfBirth,
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
    }

    authUserId = (user._id as Types.ObjectId).toString();
  }

  /** ------------------ 2 & 3. Fetch Cart + Migrate sessionId → userId ------------------ */
  let cart;
  cart = await Cart.findOne({ userId: new Types.ObjectId(authUserId) });
  if (!cart && sessionGuestId)
    cart = await Cart.findOne({ sessionId: sessionGuestId });
  if (!cart && req.auth?.sessionId)
    cart = await Cart.findOne({ sessionId: req.auth.sessionId });

  if (!cart || cart.items.length === 0)
    throw new Error("Cart is empty or not found");

  // Log cart drugIds to confirm they are UUIDs not ObjectIds
  console.log(
    "[Checkout] Cart drugIds:",
    cart.items.map((i) => i.drugId),
  );

  if (cart.sessionId && !cart.userId) {
    try {
      const migratedCart = await Cart.findOneAndUpdate(
        { _id: cart._id },
        {
          $set: { userId: new Types.ObjectId(authUserId!) },
          $unset: { sessionId: "" },
        },
        { new: true },
      );
      if (migratedCart) {
        cart = migratedCart;
        console.log(
          `[Checkout] Cart migrated sessionId → userId: ${authUserId}`,
        );
      }
    } catch (migrateErr: any) {
      if (migrateErr.code === 11000) {
        const existingUserCart = await Cart.findOne({
          userId: new Types.ObjectId(authUserId!),
        });
        if (existingUserCart) {
          for (const sessionItem of cart.items) {
            const idx = existingUserCart.items.findIndex(
              (i) => i.drugId === sessionItem.drugId,
            );
            if (idx > -1) {
              existingUserCart.items[idx].quantity += sessionItem.quantity;
            } else {
              existingUserCart.items.push(sessionItem);
            }
          }
          existingUserCart.totalItems = existingUserCart.items.reduce(
            (s, i) => s + i.quantity,
            0,
          );
          existingUserCart.totalPrice = existingUserCart.items.reduce(
            (s, i) => s + (i.price || 0) * i.quantity,
            0,
          );
          await existingUserCart.save();
          await Cart.deleteOne({ _id: cart._id });
          cart = existingUserCart;
          console.log(
            `[Checkout] Merged session cart into existing userId cart`,
          );
        }
      } else {
        console.error("[Checkout] Cart migration failed:", migrateErr.message);
      }
    }
  }

  /** ------------------ 4. Sync User with Partner ------------------ */
  const partnerId = await syncUserWithPartner(user, safePassword);
  if (!partnerId) throw new Error("Failed to get partner user ID");

  // Build partner items once — reused in cart sync and order creation
  const partnerItems = cart.items.map((item) => ({
    drug_id: item.drugId, // ✅ partner UUID
    quantity: item.quantity,
  }));

  console.log(
    "[Checkout] Partner items being sent:",
    JSON.stringify(partnerItems, null, 2),
  );

  /** ------------------ 4b. Sync Cart to Partner ------------------ */
  try {
    await axios.post(`${PARTNER_API_URL}${PARTNER_PREFIX}/cart`, {
      userId: partnerId,
      items: partnerItems,
    });
    console.log("[Checkout] Partner cart synced ✅");
  } catch (err: any) {
    // Non-fatal — log and continue, order creation carries the items anyway
    console.error(
      "[Checkout] Partner cart sync failed:",
      err.response?.data || err.message,
    );
  }

  /** ------------------ 5. Create Partner Order ------------------ */
  let partnerOrder;
  try {
    const orderRes = await axios.post(
      `${PARTNER_API_URL}${PARTNER_PREFIX}/orders`,
      {
        userId: partnerId, // ✅ partner user UUID
        telephone: user.phone,
        platform: "PlanAmWell",
        items: cart.items.map((item) => ({
          drugId: item.drugId, // ✅ partner drug UUID
          quantity: item.quantity,
        })),
      },
    );
    partnerOrder = orderRes.data.data;
    console.log(
      "[Checkout] Partner order created:",
      JSON.stringify(partnerOrder, null, 2),
    );
  } catch (err: any) {
    console.error(
      "[Checkout] Partner order failed:",
      err.response?.data || err.message,
    );
    throw new Error("Partner order creation failed");
  }

  /** ------------------ 6. Save Local Order ------------------ */
  const localOrder = await Order.create({
    orderNumber: uuidv4(),
    userId: authUserId,
    partnerOrderId: partnerOrder?.orderId, // ✅ partner order UUID
    isThirdPartyOrder: true,
    platform: "PlanAmWell",
    items: cart.items.map((i) => ({
      productId: String(i.drugId), // ✅ partner UUID stored as string
      name: i.drugName || "",
      qty: i.quantity,
      price: i.price || 0,
      dosage: i.dosage || "",
      specialInstructions: i.specialInstructions || "",
    })),
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
