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
import { randomBytes } from "crypto";
import { Payment } from "../models/initiatedPayment";
import { delimiter } from "path";
import { log } from "console";

const PARTNER_API_URL = process.env.PARTNER_API_URL || "";
const PARTNER_PREFIX = "/v1/PlanAmWell";

// Reuses the same trust boundary as CORS (index.ts's ALLOWED_ORIGINS) rather
// than inventing a separate allowlist — a caller-supplied redirect URL only
// gets used if its origin is one we already trust to make browser-facing
// requests against this API.
const ALLOWED_REDIRECT_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : [];

// Exported so paymentController's initiatePayment (resuming payment on an
// already-confirmed order) can apply the exact same web-vs-mobile redirect
// resolution as a fresh checkout, instead of always defaulting to the
// mobile-only deep link it used to hardcode.
export function resolveRedirectUrl(orderId: string, requestedRedirectUrl?: unknown): string {
  const fallback = `${process.env.APP_URL}/api/v1/payment/redirect?orderId=${orderId}`;
  if (typeof requestedRedirectUrl !== "string" || !requestedRedirectUrl) return fallback;

  try {
    const parsed = new URL(requestedRedirectUrl);
    if (ALLOWED_REDIRECT_ORIGINS.length > 0 && !ALLOWED_REDIRECT_ORIGINS.includes(parsed.origin)) {
      return fallback;
    }
    parsed.searchParams.set("orderId", orderId);
    return parsed.toString();
  } catch {
    return fallback;
  }
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_GENDERS = ["male", "female", "other"];
const ALLOWED_PREFERENCE_KEYS = [
  "homeAddress",
  "address",
  "city",
  "state",
  "lga",
  "deliveryInstructions",
];
const MAX_FIELD_LENGTH = 200;

function sanitizePreferences(
  raw: Record<string, any> | undefined,
): Record<string, any> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, any> = {};
  for (const key of ALLOWED_PREFERENCE_KEYS) {
    if (key in raw && typeof raw[key] === "string") {
      out[key] = raw[key].slice(0, MAX_FIELD_LENGTH);
    }
  }
  return out;
}

function trimField(
  value: string | undefined,
  maxLen = MAX_FIELD_LENGTH,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  return String(value).trim().slice(0, maxLen);
}

function getMissingCheckoutFields(user: any): string[] {
  const required: { field: string; label: string }[] = [
    { field: "phone", label: "Phone number" },
    { field: "gender", label: "Gender" },
    { field: "dateOfBirth", label: "Date of birth" },
  ];
  return required.filter(({ field }) => !user[field]).map(({ label }) => label);
}

/**
 * Look up a user in the partner DB by email.
 * Uses GET /v1/PlanAmWell/user?email= which returns { id, email, ... }
 */
async function getPartnerUserId(email: string): Promise<string | null> {
  try {
    const response = await axios.get(
      `${PARTNER_API_URL}${PARTNER_PREFIX}/user?email=${encodeURIComponent(email)}`,
    );
    const id = response.data?.id;
    if (id) {
      console.log(`[getPartnerUserId] Found partner ID for ${email}:`, id);
      return id;
    }
    return null;
  } catch (err: any) {
    if (err.response?.status === 404) return null;
    console.warn("[getPartnerUserId] Error:", err.response?.data || err.message);
    return null;
  }
}

/** ------------------ CHECKOUT ------------------ */
export const checkout = asyncHandler(async (req: Request, res: Response) => {
  let authUserId = req.auth?.id;
  let sessionGuestId = req.auth?.sessionId;

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
    deliveryFee,
  } = req.body;

  // Validate email format if provided
  if (email && !EMAIL_REGEX.test(String(email).trim())) {
    return res.status(400).json({ success: false, message: "Invalid email address." });
  }

  // Validate deliveryFee
const safeDeliveryFee =
  typeof deliveryFee === "number" && deliveryFee >= 0 ? deliveryFee : 0;

  // Validate gender if provided
  const normalizedGender = gender ? String(gender).toLowerCase().trim() : undefined;
  if (normalizedGender && !VALID_GENDERS.includes(normalizedGender)) {
    return res.status(400).json({ success: false, message: "Invalid gender value." });
  }

  // Validate dateOfBirth format if provided
  if (dateOfBirth && isNaN(Date.parse(String(dateOfBirth)))) {
    return res.status(400).json({ success: false, message: "Invalid date of birth." });
  }

  // Enforce field length limits
  const textFields = [name, phone, homeAddress, city, state, lga];
  if (textFields.some((f) => f !== undefined && String(f).length > MAX_FIELD_LENGTH)) {
    return res.status(400).json({
      success: false,
      message: "One or more fields exceed the maximum allowed length.",
    });
  }

  const safePassword =
    password &&
    typeof password === "string" &&
    password.length >= 8 &&
    password.length <= 25
      ? password
      : randomBytes(12).toString("hex");

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
    if (name && name !== user.name) { user.name = trimField(name); needsUpdate = true; }
    if (phone && phone !== user.phone) { user.phone = trimField(phone); needsUpdate = true; }
    if (homeAddress && homeAddress !== user.homeAddress) { user.homeAddress = trimField(homeAddress); needsUpdate = true; }
    if (city && city !== user.city) { user.city = trimField(city); needsUpdate = true; }
    if (state && state !== user.state) { user.state = trimField(state); needsUpdate = true; }
    if (lga && lga !== user.lga) { user.lga = trimField(lga); needsUpdate = true; }
    if (normalizedGender && normalizedGender !== user.gender) { user.gender = normalizedGender; needsUpdate = true; }
    if (dateOfBirth && dateOfBirth !== user.dateOfBirth) { user.dateOfBirth = dateOfBirth; needsUpdate = true; }

    const currentPrefs = (user.preferences || {}) as Record<string, any>;
    user.preferences = {
      ...currentPrefs,
      homeAddress: trimField(homeAddress),
      address: trimField(homeAddress),
      city: trimField(city),
      state: trimField(state),
      lga: trimField(lga),
      ...sanitizePreferences(preferences),
    };
    needsUpdate = true;
    if (needsUpdate) await user.save();

  } else {
    if (!name || !phone) throw new Error("Guest checkout requires name & phone");

    const existingUser = email
      ? await User.findOne({ email: email.toLowerCase().trim() })
      : null;

    if (existingUser) {
      user = existingUser;
      user.name = trimField(name);
      user.phone = trimField(phone);
      user.homeAddress = trimField(homeAddress);
      user.city = trimField(city);
      user.state = trimField(state);
      user.lga = trimField(lga);
      user.gender = normalizedGender;
      user.dateOfBirth = dateOfBirth;
      user.preferences = {
        ...(user.preferences || {}),
        homeAddress: trimField(homeAddress),
        address: trimField(homeAddress),
        city: trimField(city),
        state: trimField(state),
        lga: trimField(lga),
        ...sanitizePreferences(preferences),
      };
      user.isAnonymous = false;
      await user.save();
    } else {
      user = await User.create({
        name: trimField(name),
        phone: trimField(phone),
        email: email ? String(email).trim().toLowerCase() : undefined,
        password: safePassword,
        gender: normalizedGender,
        dateOfBirth,
        homeAddress: trimField(homeAddress),
        city: trimField(city),
        state: trimField(state),
        lga: trimField(lga),
        preferences: {
          homeAddress: trimField(homeAddress),
          address: trimField(homeAddress),
          city: trimField(city),
          state: trimField(state),
          lga: trimField(lga),
          ...sanitizePreferences(preferences),
        },
        isAnonymous: false,
        roles: ["User"],
        verified: false,
      });
    }

    authUserId = (user._id as Types.ObjectId).toString();
  }

  /** ------------------ 2 & 3. Fetch Cart + Migrate sessionId → userId ------------------ */
  let cart;
  
cart = await Cart.findOne({ 
  userId: new Types.ObjectId(authUserId!),
  status: { $in: ["active", null] }
});
if (!cart && sessionGuestId) {
  cart = await Cart.findOne({ 
    sessionId: sessionGuestId,
    status: { $in: ["active", null] }
  });
}
if (!cart && req.auth?.sessionId) {
  cart = await Cart.findOne({ 
    sessionId: req.auth.sessionId,
    status: { $in: ["active", null] }
  });
}

// ADD right before: if (!cart || cart.items.length === 0)
console.log("[Checkout] Cart lookup result:", cart ? `found: ${cart._id} status: ${cart.status} items: ${cart.items.length}` : "NOT FOUND");
console.log("[Checkout] Looking for userId:", authUserId);

// Also log ALL carts for this user:
const allCarts = await Cart.find({ userId: authUserId }).lean();
console.log("[Checkout] All carts for user:", JSON.stringify(allCarts.map(c => ({ 
  id: c._id, 
  status: c.status, 
  items: c.items.length,
  userId: c.userId,
  totalPrice: c.totalPrice
})), null, 2));


  if (!cart || cart.items.length === 0) throw new Error("Cart is empty or not found");

  console.log("[Checkout] Cart drugIds:", cart.items.map((i) => i.drugId));

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
        console.log(`[Checkout] Cart migrated sessionId → userId: ${authUserId}`);
      }
    } catch (migrateErr: any) {
      if (migrateErr.code === 11000) {
        const existingUserCart = await Cart.findOne({ userId: new Types.ObjectId(authUserId!) });
        if (existingUserCart) {
          for (const sessionItem of cart.items) {
            const idx = existingUserCart.items.findIndex((i) => i.drugId === sessionItem.drugId);
            if (idx > -1) {
              existingUserCart.items[idx].quantity += sessionItem.quantity;
            } else {
              existingUserCart.items.push(sessionItem);
            }
          }
          existingUserCart.totalItems = existingUserCart.items.reduce((s, i) => s + i.quantity, 0);
          existingUserCart.totalPrice = existingUserCart.items.reduce((s, i) => s + (i.price || 0) * i.quantity, 0);
          await existingUserCart.save();
          await Cart.deleteOne({ _id: cart._id });
          cart = existingUserCart;
          console.log(`[Checkout] Merged session cart into existing userId cart`);
        }
      } else {
        console.error("[Checkout] Cart migration failed:", migrateErr.message);
      }
    }
  }

  // ── Atomic claim — a double-tap "Checkout" or a client retry after a slow
  // response that actually succeeded must not create two Orders for the same
  // cart. Only one request can flip status from active/null to
  // "checking_out"; a concurrent duplicate finds it already claimed here and
  // stops immediately, before any partner API call or Order is created.
  const claimedCart = await Cart.findOneAndUpdate(
    { _id: cart._id, status: { $in: ["active", null] } },
    { $set: { status: "checking_out" } },
    { new: true }
  );
  if (!claimedCart) {
    return res.status(409).json({
      success: false,
      code: "CHECKOUT_IN_PROGRESS",
      message: "This cart is already being checked out.",
    });
  }
  cart = claimedCart;

  // Any failure from here through Order creation must release the claim
  // (revert the cart to "active") so the user can retry checkout instead of
  // being permanently stuck — that's exactly the "stuck order" failure mode
  // this whole guard is meant to prevent, just moved earlier.
  const releaseClaim = () =>
    Cart.updateOne({ _id: cart._id, status: "checking_out" }, { $set: { status: "active" } }).catch(
      (e) => console.error("[Checkout] Failed to release cart claim:", e.message)
    );

  /** ------------------ 4. Sync User + Cart with Partner ------------------ */
  let partnerUserId: string | null = user.partnerId ?? null;

  if (!partnerUserId) {
    try {
      const partnerRes = await axios.post(
        `${PARTNER_API_URL}${PARTNER_PREFIX}/accounts-with-cart`,
        {
          user: { email: user.email, name: user.name, password: safePassword },
          cart: {
            platform: "paw",
            items: cart.items.map((item) => ({
              drug_id: item.drugId,
              quantity: item.quantity,
            })),
          },
        },
      );

      console.log("[Checkout] accounts-with-cart response:", JSON.stringify(partnerRes.data, null, 2));

      // ✅ Partner returns { user_id, message }
      partnerUserId =
        partnerRes.data?.user_id ||
        partnerRes.data?.userId ||
        partnerRes.data?.user?.id;

      if (!partnerUserId) {
        console.error("[Checkout] Could not extract partnerId — full response:", partnerRes.data);
        throw new Error("CRITICAL: Partner userId missing after sync");
      }

      // ✅ Save immediately before any further logic that could throw
      user.partnerId = partnerUserId;
      await user.save();
      console.log("[Checkout] Partner user created and saved:", partnerUserId);

    } catch (err: any) {
      const isAxiosError = !!err.response;
      const msg = isAxiosError ? (err.response?.data?.message || "") : err.message;
      const status = err.response?.status;

      console.error(
        "[Checkout] accounts-with-cart failed:",
        isAxiosError ? err.response?.data : err.message,
      );

      if (msg.includes("already exists") || status === 409 || status === 500) {
        // ✅ User exists in partner — look them up via /user?email=
        if (user.email) {
          const recoveredId = await getPartnerUserId(user.email);
          if (recoveredId) {
            partnerUserId = recoveredId;
            user.partnerId = recoveredId;
            await user.save();
            console.log("[Checkout] Recovered partner ID via /user search:", recoveredId);
            // ✅ Fall through to order creation
          } else {
            console.error(`[Checkout] MANUAL FIX NEEDED: ${user.email} not found via /user search`);
            await releaseClaim();
            return res.status(503).json({
              success: false,
              code: "PARTNER_SYNC_FAILED",
              message:
                "We couldn't link your account to complete the order. " +
                "Please contact support — your cart has been saved.",
            });
          }
        } else {
          await releaseClaim();
          return res.status(503).json({
            success: false,
            code: "PARTNER_SYNC_FAILED",
            message: "We couldn't link your account. Please contact support.",
          });
        }
      } else {
        // Non-"already exists" axios error or unknown local error
        await releaseClaim();
        return res.status(502).json({
          success: false,
          code: "PARTNER_SYNC_FAILED",
          message: "Failed to sync with partner system. Please try again.",
        });
      }
    }
  }

  /** ------------------ 5. Save Local Order ------------------ */
  let localOrder;
  try {
    localOrder = await Order.create({
      orderNumber: uuidv4(),
      userId: authUserId,
      isThirdPartyOrder: true,
      platform: "PlanAmWell",
      items: cart.items.map((i) => ({
        productId: String(i.drugId),
        name: i.drugName || "",
        qty: i.quantity,
        price: i.price || 0,
        dosage: i.dosage || "",
        specialInstructions: i.specialInstructions || "",
      })),
      subtotal: cart.totalPrice,
      shippingFee: safeDeliveryFee,
      total: cart.totalPrice + safeDeliveryFee,
      paymentStatus: "pending",
      deliveryMethod: "delivery",
      shippingAddress: {
        name: user.name,
        phone: user.phone,
        addressLine: user.homeAddress || (user.preferences as any)?.address,
        city: user.city || (user.preferences as any)?.city,
        state: user.state || (user.preferences as any)?.state,
        lga: user.lga || (user.preferences as any)?.lga,
      },
    });
  } catch (orderErr: any) {
    console.error("[Checkout] Order.create failed:", orderErr.message);
    await releaseClaim();
    return res.status(500).json({
      success: false,
      code: "ORDER_CREATE_FAILED",
      message: "Failed to create your order. Please try checking out again.",
    });
  }

  /** ------------------ 6. Mark Cart checked_out ------------------ */
  // Best-effort — the Order above is already safely created at this point,
  // which is the part the user actually cares about. A failure here (cart
  // already "checking_out", so nothing else can touch it anyway) shouldn't
  // turn a successful checkout into an error response with no orderId.
  try {
    await Cart.findByIdAndUpdate(cart._id, {
      status: "checked_out",
      orderId: localOrder._id,
    });
    await Cart.findByIdAndDelete(cart._id);
    console.log("[Checkout] Cart deleted after checkout");
  } catch (cleanupErr: any) {
    console.error("[Checkout] Cart cleanup after successful order failed (non-fatal):", cleanupErr.message);
  }

  /** ------------------ 7. Respond ------------------ */
  res.status(201).json({
    success: true,
    message: "Checkout successful",
    localOrder,
    partnerUserId,
    user: {
      id: user._id,
      isAnonymous: user.isAnonymous,
      partnerId: user.partnerId,
    },
  });
});

/** ------------------ CONFIRM ORDER ------------------ */
export const confirmOrder = asyncHandler(async (req: Request, res: Response) => {
  const { orderId, redirectUrl } = req.body;
  const authUserId = req.auth?.id;

  console.log("[ConfirmOrder] START — orderId:", orderId, "authUserId:", authUserId);

  if (!orderId) {
    return res.status(400).json({ success: false, message: "orderId is required" });
  }

  const existing = await Order.findById(orderId);
  if (!existing) {
    return res.status(404).json({ success: false, message: "Order not found" });
  }
  if (existing.userId?.toString() !== authUserId) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }

  if (existing.partnerOrderId && existing.partnerOrderId !== "PENDING") {
    const existingPayment = await Payment.findOne({ orderId: existing._id.toString() });
    console.log("[ConfirmOrder] Idempotency — payment found:", !!existingPayment, "checkoutUrl:", existingPayment?.checkoutUrl);

    if (!existingPayment) {
      console.warn("[ConfirmOrder] Partner order exists but no payment record — will re-initiate payment");
      // fall through
    } else {
      return res.status(200).json({
        success: true,
        checkoutUrl: existingPayment.checkoutUrl,
        orderId: existing._id,
      });
    }
  }

  // ── Atomic claim — prevents two concurrent confirm requests (double-tap,
  // a retried request that actually succeeded) from both creating a partner
  // order + payment session for the same local order. Only one request can
  // flip partnerOrderId from unset to the "PENDING" sentinel; any other
  // concurrent request sees it already claimed and backs off cleanly below.
  //
  // A claim older than 2 minutes is treated as abandoned (the process that
  // made it crashed or hung before reaching the catch blocks that normally
  // release it) and can be retaken, so a single bad request can't strand an
  // order in "PENDING" forever.
  const claimIsStale =
    existing.partnerOrderId === "PENDING" &&
    Date.now() - new Date(existing.updatedAt || 0).getTime() > 2 * 60 * 1000;

  const claimFilter =
    existing.partnerOrderId === "PENDING" && !claimIsStale
      ? null // freshly claimed by someone else — don't even try
      : {
          _id: orderId,
          userId: authUserId,
          partnerOrderId: claimIsStale ? "PENDING" : { $in: [null, undefined] },
        };

  const claimed = claimFilter
    ? await Order.findOneAndUpdate(
        claimFilter,
        { $set: { partnerOrderId: "PENDING" } },
        { new: true }
      )
    : null;

  if (!claimed) {
    return res.status(409).json({
      success: false,
      code: "CONFIRM_IN_PROGRESS",
      message: "This order is already being processed. Please wait a moment and refresh.",
    });
  }

  const order = claimed;

  const user = await User.findById(authUserId);
  if (!user || !user.partnerId) {
    await Order.updateOne({ _id: orderId }, { $set: { partnerOrderId: null } }); // release claim
    return res.status(422).json({ success: false, message: "User not synced with partner" });
  }

  /** --- Create Partner Order --- */
  let partnerOrder;
  try {
    const orderRes = await axios.post(
  `${PARTNER_API_URL}${PARTNER_PREFIX}/orders`,
  {
    userId: user.partnerId,
    telephone: user.phone,
    platform: "PlanAmWell",
    state: user.state || (user.preferences as any)?.state || "",
    lga: user.lga || (user.preferences as any)?.lga || "",
    deliveryMethod: "delivery",
    items: order.items.map((item) => ({
      drugId: item.productId,
      quantity: item.qty,
    })),
  },
);
    partnerOrder = orderRes.data.data;
    console.log("[ConfirmOrder] Partner order created:", JSON.stringify(partnerOrder, null, 2));
  } catch (err: any) {
    console.error("[ConfirmOrder] Partner order failed:", err.response?.data || err.message);
    await Order.updateOne({ _id: orderId }, { $set: { partnerOrderId: null } }); // release claim — allow retry
    return res.status(502).json({ success: false, message: "Failed to create partner order" });
  }

  order.partnerOrderId = partnerOrder?.orderId;
  order.partnerOrderCode = partnerOrder?.orderCode;
  // Partner returns the field as "deliveryFee". Wrap in Number() so a string
  // value like "1500" doesn't turn the addition below into string concatenation.
  order.shippingFee = Number(partnerOrder?.deliveryFee ?? partnerOrder?.shippingFee ?? order.shippingFee ?? 0);
  order.total = order.subtotal + order.shippingFee;

  await order.save();

  /** --- Initiate Payment --- */
  const PARTNER_API_KEY = process.env.PARTNER_API_KEY;
  const partnerReferenceCode = `PAW-${order.orderNumber}`;
  const mobileRedirectUrl = resolveRedirectUrl(String(order._id), redirectUrl);

  try {
    const paymentRes = await axios.post(
      `${PARTNER_API_URL}${PARTNER_PREFIX}/payments/initiate`,
      {
        orderId: partnerOrder?.orderId,
        userId: user.partnerId,
        paymentMethod: "card",
        amount: order.total,
        partnerReferenceCode,
        apiKey: PARTNER_API_KEY,
        customerEmail: user.email,
        mobile_redirect_url: mobileRedirectUrl,
      },
    );

    console.log("[ConfirmOrder] Payment response:", JSON.stringify(paymentRes.data, null, 2));

    const checkoutUrl = paymentRes.data?.initializedPayment?.data?.authorization_url;
    const transactionId = paymentRes.data?.payment?.transactionId;
    const paymentReference = paymentRes.data?.initializedPayment?.data?.reference;

    if (!checkoutUrl) {
      throw new Error("No checkout URL returned from partner");
    }

    // ✅ Guard against duplicate key crash on retry
    const existingPayment = await Payment.findOne({ orderId: order._id.toString() });
    if (!existingPayment) {
      try {
        await Payment.create({
          orderId: order._id.toString(),
          userId: user._id.toString(),
          paymentMethod: "card",
          partnerReferenceCode,
          paymentReference,
          transactionId,
          checkoutUrl,
          amount: order.total,
          status: "pending",
        });
        console.log("[ConfirmOrder] Payment record saved ✅");
      } catch (saveErr: any) {
        if (saveErr.code === 11000) {
          console.warn("[ConfirmOrder] Duplicate payment record — already exists, continuing");
        } else {
          throw saveErr;
        }
      }
    }

    console.log("[ConfirmOrder] Sending response:", JSON.stringify({ success: true, checkoutUrl, orderId: order._id }));

    return res.status(200).json({
      success: true,
      checkoutUrl,
      orderId: order._id,
       shippingFee: order.shippingFee,  
  total: order.total,  
  deliveryMethod: order.deliveryMethod,
    });

  } catch (err: any) {
    console.error("[ConfirmOrder] Payment initiation failed:", err.response?.data || err.message);
    return res.status(502).json({ success: false, message: "Failed to initiate payment" });
  }
});


// ─────────────────────────────────────────────
// GET /checkout/delivery-zones — states + LGAs the delivery partner actually
// services, grouped and priced. Used to preload the checkout location picker
// so users can only select an address the partner can deliver to, instead of
// picking any Nigerian state/LGA and silently getting "free" delivery when
// the partner has no coverage there.
// Cached in-memory for 15 minutes — the zone list changes rarely and this
// keeps checkout screen opens from hitting the partner API every time.
// ─────────────────────────────────────────────
interface DeliveryZoneLga {
  name: string;
  price: number;
}
interface DeliveryZoneState {
  state: string;
  lgas: DeliveryZoneLga[];
}

const ZONES_CACHE_TTL_MS = 15 * 60 * 1000;
let zonesCache: { data: DeliveryZoneState[]; expiresAt: number } | null = null;

export const getDeliveryZones = asyncHandler(async (req: Request, res: Response) => {
  if (zonesCache && zonesCache.expiresAt > Date.now()) {
    return res.status(200).json({ success: true, data: zonesCache.data, cached: true });
  }

  try {
    const response = await axios.get(`${PARTNER_API_URL}/v1/delivery-zones`);
    const rawZones: { state: string; lga: string; price: number }[] = response.data || [];

    const byState = new Map<string, DeliveryZoneLga[]>();
    for (const zone of rawZones) {
      if (!zone?.state || !zone?.lga) continue;
      if (!byState.has(zone.state)) byState.set(zone.state, []);
      byState.get(zone.state)!.push({ name: zone.lga, price: zone.price ?? 0 });
    }

    const zones: DeliveryZoneState[] = Array.from(byState.entries())
      .map(([state, lgas]) => ({
        state,
        lgas: lgas.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.state.localeCompare(b.state));

    zonesCache = { data: zones, expiresAt: Date.now() + ZONES_CACHE_TTL_MS };

    return res.status(200).json({ success: true, data: zones, cached: false });
  } catch (err: any) {
    console.error("[getDeliveryZones] Failed:", err.response?.data || err.message);

    // Serve stale cache rather than fail the checkout screen outright, if we have one
    if (zonesCache) {
      return res.status(200).json({ success: true, data: zonesCache.data, cached: true, stale: true });
    }

    return res.status(502).json({ success: false, message: "Could not fetch delivery zones" });
  }
});

export const getDeliveryFee = asyncHandler(async (req: Request, res: Response) => {
  const { state, lga } = req.query;

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');


  if (!state || !lga) {
    return res.status(400).json({ success: false, message: "state and lga are required" });
  }

  try {
    const response = await axios.get(
      `${PARTNER_API_URL}${PARTNER_PREFIX}/delivery/fee`,
      { params: { state, lga } }
    );
console.log("[getDeliveryFee] Response:", JSON.stringify(response.data, null, 2));
    const deliveryFee = response.data?.deliveryFee ?? 0;

    console.log("Partner delivery fee", deliveryFee);
    return res.status(200).json({
      success: true,
      data: {
        state,
        lga,
        deliveryFee,
      },
    });
  } catch (err: any) {
  if (err.response?.status === 404) {
  console.log("[getDeliveryFee] Zone not found for state:", state, "lga:", lga);
  return res.status(200).json({
    success: true,
    data: { state, lga, deliveryFee: 0 },
    message: "Delivery zone not found — defaulting to free delivery",
  });
}
    console.error("[getDeliveryFee] Failed:", err.response?.data || err.message);
    return res.status(502).json({ success: false, message: "Could not fetch delivery fee" });
  }
});