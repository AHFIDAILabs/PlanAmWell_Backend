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
    // ── Authenticated user path ──────────────────────────────────────────────
    user = await User.findById(authUserId);
    if (!user) throw new Error("Authenticated user not found");

    // ── Profile completeness gate ────────────────────────────────────────────
    // We run this BEFORE updating the user so that missing fields sent in the
    // request body (which we're about to merge) are detected from the *current*
    // saved state. The frontend pre-flight check already blocked most of these;
    // this is the server-side safety net.
    //
    // Exception: if all three fields are supplied in this very request we allow
    // the checkout to proceed and update them in the same transaction below —
    // this supports the case where CompleteProfileModal just saved via
    // PATCH /users/me and the client immediately retries checkout.
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
        missingFields, // e.g. ["Phone number", "Date of birth"]
      });
    }
    // ────────────────────────────────────────────────────────────────────────

    // Update user fields if the checkout form sent new values
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
    // ── Guest / anonymous path ───────────────────────────────────────────────
    // Guests fill all fields inline in CheckoutScreen so no gate here —
    // validateForm() on the client already ensures phone/gender/dob are present.
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
    }

  authUserId = (user._id as Types.ObjectId).toString();
  }

  /** ------------------ 2 & 3. Fetch Cart + Migrate sessionId → userId ------------------ */

  // At this point authUserId is always set (either from token or from the
  // guest registration block above that does: authUserId = user.id.toString())
  let cart;

  // Try userId first (logged-in or already-migrated cart)
  cart = await Cart.findOne({ userId: new Types.ObjectId(authUserId) });

  // Fall back to sessionId cart (guest who just registered at checkout)
  if (!cart && sessionGuestId) {
    cart = await Cart.findOne({ sessionId: sessionGuestId });
  }

  // If still nothing, the user might have had a sessionId cart before but
  // it was never linked — try finding by the session from their auth token
  if (!cart && req.auth?.sessionId) {
    cart = await Cart.findOne({ sessionId: req.auth.sessionId });
  }

  if (!cart || cart.items.length === 0) {
    throw new Error("Cart is empty or not found");
  }

  // ── Migrate: if this is a sessionId cart, promote it to userId ────────────
  // We do this BEFORE partner sync so everything downstream uses userId
  if (cart.sessionId && !cart.userId) {
    try {
      // Use findOneAndUpdate to atomically swap sessionId → userId
      // This avoids the unique-index conflict that happens with cart.save()
      // when the sessionId index is still set
      const migratedCart = await Cart.findOneAndUpdate(
        { _id: cart._id },
        {
          $set: { userId: new Types.ObjectId(authUserId!) },
          $unset: { sessionId: "" }, // removes the sessionId index entry
        },
        { new: true },
      );

      if (migratedCart) {
        cart = migratedCart;
        console.log(
          `[Checkout] Cart migrated from sessionId → userId: ${authUserId}`,
        );
      }
    } catch (migrateErr: any) {
      // If a userId cart already exists (race condition), merge items into it
      if (migrateErr.code === 11000) {
        const existingUserCart = await Cart.findOne({
          userId: new Types.ObjectId(authUserId!),
        });

        if (existingUserCart) {
          // Merge session cart items into the userId cart
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
          await Cart.deleteOne({ _id: cart._id }); // remove orphaned session cart
          cart = existingUserCart;
          console.log(
            `[Checkout] Merged session cart into existing userId cart`,
          );
        }
      } else {
        console.error("[Checkout] Cart migration failed:", migrateErr.message);
        // Non-fatal — continue with the session cart as-is
      }
    }
  }

  /** ------------------ 4. Sync User with Partner ------------------ */
  const partnerId = await syncUserWithPartner(user, safePassword);
  if (!partnerId) throw new Error("Failed to get partner user ID");

  // ✅ NEW: Sync cart to partner BEFORE creating the order
  /** ------------------ 4b. Sync Cart to Partner ------------------ */
  try {
    const partnerCartItems = await Promise.all(
      cart.items.map(async (item) => {
        const product = await Product.findById(item.drugId);
        if (!product) throw new Error(`Product not found: ${item.drugId}`);
        if (!product.partnerProductId)
          throw new Error(`partnerProductId missing for: ${product.name}`);
        return {
          drug_id: product.partnerProductId,
          quantity: item.quantity,
          dosage: item.dosage || "",
          special_instructions: item.specialInstructions || "",
        };
      }),
    );

    await axios.post(`${PARTNER_API_URL}${PARTNER_PREFIX}/cart`, {
      userId: partnerId,
      items: partnerCartItems,
    });

    console.log("[Checkout] Partner cart synced successfully before order");
  } catch (cartSyncErr: any) {
    console.error(
      "[Checkout] Partner cart sync failed:",
      cartSyncErr.response?.data || cartSyncErr.message,
    );
  }

  /** ------------------ 5. Prepare Partner Order ------------------ */
  const productLookup = new Map();
  for (const item of cart.items) {
    const product = await Product.findById(item.drugId);
    if (!product) throw new Error(`Product not found: ${item.drugId}`);
    if (!product.partnerProductId)
      throw new Error(
        `Partner product ID missing for ${product.name} (${item.drugId})`,
      );
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

    const orderRes = await axios.post(
      `${PARTNER_API_URL}${PARTNER_PREFIX}/orders`,
      payload,
    );
    partnerOrder = orderRes.data.data;
  } catch (err: any) {
    console.error(
      "[Checkout] Failed to create partner order:",
      err.response?.data || err.message,
    );
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
