import { Request, Response } from "express";
import { Types } from "mongoose";
import { randomBytes, createHash } from "crypto";
const jwt = require("jsonwebtoken");
import { User } from "../models/user";
import { Doctor } from "../models/doctor";
import { Session } from "../models/sessions";
import { Cart } from "../models/cart";
import asyncHandler from "../middleware/asyncHandler";
import {signJwt, signRefreshToken} from "../middleware/auth";
import bcrypt from "bcryptjs";
import { Admin } from "../models/admin";
import { RefreshToken } from "../models/refreshToken";
import { sendPasswordResetEmail } from "../services/emailService";

if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET missing from .env");


// -------------------- Guest User --------------------

// POST /auth/guest
export const createGuestSession = asyncHandler(async (req: Request, res: Response) => {
  const session = await Session.create({ isAnonymous: true });
  // signJwt's guest branch keys off entity._id (not entity.sessionId) to
  // build the token's `sessionId` claim — passing `sessionId` here instead
  // of `_id` meant that condition (entity.isAnonymous && entity._id) never
  // matched, silently falling through to the generic branch and minting a
  // token with NO sessionId/isAnonymous claim at all (just a bare
  // {role:"User", name:"User"}). Confirmed by decoding a real token from
  // this endpoint — every guest session, on both mobile and web, has been
  // getting this broken shape.
  const token = signJwt({ _id: session._id, isAnonymous: true });

  res.status(201).json({
    success: true,
    sessionId: session._id,
    token,
    isAnonymous: true,
  });
});


// -------------------- Push Token Management --------------------

/**
 *  Register Expo push token
 * POST /auth/register-push-token
 */
export const registerPushToken = asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.body;
  const userId = req.auth?.id;

  if (!token) {
    res.status(400);
    throw new Error("Push token is required");
  }

  if (!userId) {
    res.status(401);
    throw new Error("Unauthorized - User not found");
  }

  // handleLogin calls this endpoint for both User and Doctor accounts —
  // without this fallback, doctor logins 404 here (silently swallowed by
  // the frontend), leaving Doctor.expoPushTokens permanently empty and
  // every call placed to that doctor rings nobody.
  const account = (await User.findById(userId)) || (await Doctor.findById(userId));
  if (!account) {
    res.status(404);
    throw new Error("User not found");
  }

  if (typeof (account as any).addExpoPushToken === "function") {
    await (account as any).addExpoPushToken(token);
  } else if (!account.expoPushTokens?.includes(token)) {
    account.expoPushTokens = account.expoPushTokens || [];
    account.expoPushTokens.push(token);
    await account.save();
  }

  res.status(200).json({
    success: true,
    message: "Push token registered successfully"
  });
});

/**
 *  Remove Expo push token (on logout)
 * POST /auth/remove-push-token
 */
export const removePushToken = asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.body;
  const userId = req.auth?.id;

  if (!token) {
    res.status(400);
    throw new Error("Push token is required");
  }

  if (!userId) {
    res.status(401);
    throw new Error("Unauthorized - User not found");
  }

  const account = (await User.findById(userId)) || (await Doctor.findById(userId));
  if (!account) {
    res.status(404);
    throw new Error("User not found");
  }

  if (typeof (account as any).removeExpoPushToken === "function") {
    await (account as any).removeExpoPushToken(token);
  } else if (account.expoPushTokens) {
    account.expoPushTokens = account.expoPushTokens.filter((t: string) => t !== token);
    await account.save();
  }

  res.status(200).json({
    success: true,
    message: "Push token removed successfully"
  });
});

/**
 *  Register raw FCM device token (separate from the Expo push token above —
 *  used only to wake the background/foreground handlers for incoming-call
 *  ringing when the app is backgrounded or killed)
 * POST /auth/register-fcm-token
 */
export const registerFcmToken = asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.body;
  const userId = req.auth?.id;

  if (!token) {
    res.status(400);
    throw new Error("FCM token is required");
  }

  if (!userId) {
    res.status(401);
    throw new Error("Unauthorized - User not found");
  }

  const account = (await User.findById(userId)) || (await Doctor.findById(userId));
  if (!account) {
    res.status(404);
    throw new Error("User not found");
  }

  await (account as any).addFcmToken(token);

  res.status(200).json({ success: true, message: "FCM token registered successfully" });
});

/**
 *  Remove raw FCM device token (on logout)
 * POST /auth/remove-fcm-token
 */
export const removeFcmToken = asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.body;
  const userId = req.auth?.id;

  if (!token) {
    res.status(400);
    throw new Error("FCM token is required");
  }

  if (!userId) {
    res.status(401);
    throw new Error("Unauthorized - User not found");
  }

  const account = (await User.findById(userId)) || (await Doctor.findById(userId));
  if (!account) {
    res.status(404);
    throw new Error("User not found");
  }

  await (account as any).removeFcmToken(token);

  res.status(200).json({ success: true, message: "FCM token removed successfully" });
});

// -------------------- Convert Guest -> Full User --------------------

// POST /auth/convert
export const convertGuestToUser = asyncHandler(async (req: Request, res: Response) => {
  const { sessionId, name, email, phone, password, dateOfBirth, homeAddress, city, state, lga } = req.body;
  if (!sessionId) return res.status(400).json({ message: "SessionId required" });

  const session = await Session.findById(sessionId) as any;
  if (!session) return res.status(404).json({ message: "Session not found" });

  if (!session.isAnonymous)
    return res.status(400).json({ message: "Session already converted" });

  // Create a new user
  const newUser = await User.create({
    name,
    email,
    password,
    phone,
    dateOfBirth,
    homeAddress,
    city,
    state,
    lga,
    roles: ["User"],
    isAnonymous: false,
  });

  // Link session to user
  session.userId = newUser._id;
  session.isAnonymous = false;
  await session.save();

  // Link cart to user
  const cart = await Cart.findOne({ sessionId });
  if (cart) {
    cart.userId = newUser._id as any;
    cart.sessionId = undefined; // Clear sessionId to avoid confusion/conflicts
    await cart.save();
  }

  const token = signJwt({ userId: newUser._id, sessionId: session._id, role: "User" });

  res.status(201).json({
    success: true,
    token,
    user: {
      _id: newUser._id,
      name: newUser.name,
      email: newUser.email,
      phone: newUser.phone,
      roles: newUser.roles,
    },
    sessionId: session._id,
  });
});

// ------------------ CREATE User (Local Only) ------------------

export const createUser = asyncHandler(async (req: Request, res: Response) => {
  if (req.auth?.id) {
    res.status(400);
    throw new Error("Already logged in, cannot create new account");
  }
 
  // ✅ Only these three are required at signup
  const { name, email, password } = req.body;
 
  if (!name || !email || !password) {
    res.status(400);
    throw new Error("name, email and password are required");
  }
 
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return res.status(409).json({
      success: false,
      message: "User with this email already exists",
    });
  }
 
  // Optional fields — collected later during checkout / appointment booking
  const {
    phone,
    dateOfBirth,
    homeAddress,
    city,
    state,
    lga,
    gender,
    roles,
  } = req.body;
 
  const newUser = await User.create({
    name,
    email,
    password,
    // Optional — undefined values are silently ignored by Mongoose
    phone: phone || undefined,
    dateOfBirth: dateOfBirth || undefined,
    homeAddress: homeAddress || undefined,
    city: city || undefined,
    state: state || undefined,
    lga: lga || undefined,
    gender: gender || undefined,
    roles: ["User"], // never trust client-supplied roles — privilege escalation
    verified: true,
  });
 
  const fullUser = await User.findById(newUser._id).populate("userImage");
  const userResponse = fullUser?.toObject({ virtuals: true });
  if (userResponse?.password) delete userResponse.password;
 
  res.status(201).json({
    success: true,
    data: userResponse,
  });
});



// ------------------- Login User -------------------

export const loginUser = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400);
    throw new Error("Email and password are required");
  }

  // Find user
  const user = await User.findOne({ email }).select("+password");

  if (!user) {
    res.status(401);
    throw new Error("Invalid credentials");
  }

  // Verify password
  const isMatch = await user.comparePassword(password);

  if (!isMatch) {
    res.status(401);
    throw new Error("Invalid credentials");
  }

  // Generate tokens
  const token = signJwt(user);
  const { token: refreshToken } = await signRefreshToken(user); // ← Generate refresh token

  // console.log("[Auth] User logged in:", user.email);

  res.status(200).json({
    success: true,
    token,
    refreshToken, // ← Return refresh token
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      roles: user.roles,
      userImage: user.userImage,
    },
    message: "Login successful",
  });
});


//..........................Login Doctor...................................
/**
 * 🧑‍⚕️ POST /api/v1/auth/doctor/login
 * Handles doctor authentication and checks for 'approved' status.
 */
export const doctorLogin = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400);
    throw new Error("Email and password are required");
  }

  // Find doctor
  const doctor = await Doctor.findOne({ email }).select("+passwordHash");

  if (!doctor) {
    res.status(401);
    throw new Error("Invalid credentials");
  }

  // Verify password
  const isMatch = await bcrypt.compare(password, doctor.passwordHash);

  if (!isMatch) {
    res.status(401);
    throw new Error("Invalid credentials");
  }

  // Check if doctor is approved
  if (doctor.status !== "approved") {
    res.status(403);
    throw new Error("Your account is pending approval");
  }

  // Generate tokens
  const token = signJwt(doctor);
  const { token: refreshToken } = await signRefreshToken(doctor); // ← Generate refresh token

  // console.log("[Auth] Doctor logged in:", doctor.email);

  res.status(200).json({
    success: true,
    token,
    refreshToken, // ← Return refresh token
    user: {
      _id: doctor._id,
      firstName: doctor.firstName,
      lastName: doctor.lastName,
      email: doctor.email,
      specialization: doctor.specialization,
      profileImage: doctor.profileImage,
      role: "Doctor",
    },
    message: "Login successful",
  });
});

// -------------------- Protected User Routes Example --------------------

// GET /auth/me
export const getCurrentUser = asyncHandler(async (req: Request & { user?: any }, res: Response) => {
  if (!req.user) return res.status(401).json({ message: "Unauthorized" });
  res.status(200).json({ success: true, user: req.user });
});


// Refresh token

export const refreshToken = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    res.status(400);
    throw new Error("Refresh token is required");
  }

  try {
    // 1️⃣ Decode JWT - check expiry FIRST
    const decoded: any = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET!);
    const userId = decoded.id;

    // 2️⃣ Find user in any collection
    const user =
      (await User.findById(userId)) ||
      (await Doctor.findById(userId)) ||
      (await Admin.findById(userId));

    if (!user) {
      res.status(401);
      throw new Error("User not found");
    }

    // 3️⃣ Find all refresh tokens for this user
    const storedTokens = await RefreshToken.find({ 
      userId: user._id,
      expiresAt: { $gt: new Date() } // ✅ Only get non-expired tokens
    });

    if (storedTokens.length === 0) {
      res.status(401);
      throw new Error("No valid refresh tokens found");
    }

    // 4️⃣ Compare incoming token to hashed tokens
    let matchedToken = null;
    for (const t of storedTokens) {
      if (await bcrypt.compare(refreshToken, t.token)) {
        matchedToken = t;
        break;
      }
    }

    if (!matchedToken) {
      res.status(401);
      throw new Error("Refresh token invalid or revoked");
    }

    // ✅ 5️⃣ Generate NEW tokens BEFORE deleting old one
    const newAccessToken = signJwt(user);
    const { token: newRefreshToken, hashedToken } = await signRefreshToken(user);

    // ✅ 6️⃣ NOW delete the old refresh token
    await RefreshToken.deleteOne({ _id: matchedToken._id });

    console.log("✅ Token refreshed successfully for user:", userId);

    res.status(200).json({
      success: true,
      token: newAccessToken,
      refreshToken: newRefreshToken, // send rotated refresh token
    });
  } catch (err: any) {
    console.error("Refresh Token Error:", err.message);
    
    // ✅ Better error messages
    if (err.name === 'TokenExpiredError') {
      res.status(401);
      throw new Error("Refresh token has expired. Please login again.");
    }
    
    res.status(401);
    throw new Error("Invalid or expired refresh token");
  }
});


// ─────────────────────────────────────────────
// DELETE /auth/me  — Self-service account deletion
// Requires the user to confirm with their password
// ─────────────────────────────────────────────
export const deleteMyAccount = asyncHandler(async (req: Request, res: Response) => {
  const { password } = req.body;
  const authId = req.auth?.id;
  const role = req.auth?.role;

  if (!authId) {
    res.status(401);
    throw new Error("Not authenticated");
  }

  if (!password) {
    res.status(400);
    throw new Error("Password is required to delete your account");
  }

  if (role === "Doctor") {
    const doctor = await Doctor.findById(authId);
    if (!doctor) { res.status(404); throw new Error("Account not found"); }

    const match = await bcrypt.compare(password, doctor.passwordHash);
    if (!match) { res.status(401); throw new Error("Incorrect password"); }

    await Doctor.findByIdAndDelete(authId);
    await RefreshToken.deleteMany({ userId: authId });
  } else {
    const user = await User.findById(authId).select("+password");
    if (!user || !user.password) { res.status(404); throw new Error("Account not found"); }

    const match = await bcrypt.compare(password, user.password);
    if (!match) { res.status(401); throw new Error("Incorrect password"); }

    await User.findByIdAndDelete(authId);
    await RefreshToken.deleteMany({ userId: authId });
  }

  res.status(200).json({ success: true, message: "Account deleted successfully." });
});

// ─────────────────────────────────────────────
// POST /auth/delete-by-credentials — Public, web-based account deletion.
// Lets someone delete their account from a browser, without the app
// installed, as required by Google Play's account deletion policy.
// Identity is confirmed with email + password — the same trust level as
// logging in — since a browser session has no app-issued JWT to present.
// ─────────────────────────────────────────────
export const requestAccountDeletionByCredentials = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400);
    throw new Error("Email and password are required.");
  }

  const trimmedEmail = String(email).trim();

  const user = await User.findOne({ email: trimmedEmail }).select("+password");
  if (user && user.password && (await bcrypt.compare(password, user.password))) {
    await User.findByIdAndDelete(user._id);
    await RefreshToken.deleteMany({ userId: user._id });
    res.status(200).json({ success: true, message: "Account deleted successfully." });
    return;
  }

  const doctor = await Doctor.findOne({ email: trimmedEmail });
  if (doctor && (await bcrypt.compare(password, doctor.passwordHash))) {
    await Doctor.findByIdAndDelete(doctor._id);
    await RefreshToken.deleteMany({ userId: doctor._id });
    res.status(200).json({ success: true, message: "Account deleted successfully." });
    return;
  }

  // Same generic error either way — don't reveal whether the email exists.
  res.status(401);
  throw new Error("Invalid email or password.");
});

// ─────────────────────────────────────────────
// POST /auth/forgot-password — Sends a reset link if the email matches a
// User or Doctor account. Always responds success either way, so the
// response can never be used to enumerate registered emails.
// ─────────────────────────────────────────────
function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const { email } = req.body;

  if (!email) {
    res.status(400);
    throw new Error("Email is required.");
  }

  const trimmedEmail = String(email).trim();
  const rawToken = randomBytes(32).toString("hex");
  const hashedToken = hashResetToken(rawToken);
  const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  const account =
    (await User.findOne({ email: trimmedEmail })) || (await Doctor.findOne({ email: trimmedEmail }));

  if (account) {
    account.resetPasswordToken = hashedToken;
    account.resetPasswordExpires = expires;
    await account.save();

    const resetUrl = `${process.env.WEB_APP_URL || "http://localhost:3000"}/reset-password?token=${rawToken}`;
    await sendPasswordResetEmail(trimmedEmail, resetUrl);
  }

  res.status(200).json({ success: true, message: "If that email exists, we've sent a reset link." });
});

// ─────────────────────────────────────────────
// POST /auth/reset-password — Redeems a reset token minted by forgotPassword
// above. Invalidates existing refresh tokens on success so any other signed-
// in sessions for that account are logged out.
// ─────────────────────────────────────────────
export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const { token, password } = req.body;

  if (!token || !password) {
    res.status(400);
    throw new Error("Token and password are required.");
  }

  const hashedToken = hashResetToken(token);

  const user = await User.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpires: { $gt: new Date() },
  }).select("+resetPasswordToken +resetPasswordExpires");

  if (user) {
    user.password = password; // pre-save hook rehashes
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    await RefreshToken.deleteMany({ userId: user._id });
    res.status(200).json({ success: true, message: "Password reset successfully." });
    return;
  }

  const doctor = await Doctor.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpires: { $gt: new Date() },
  }).select("+resetPasswordToken +resetPasswordExpires");

  if (doctor) {
    doctor.passwordHash = await bcrypt.hash(password, 10);
    doctor.resetPasswordToken = undefined;
    doctor.resetPasswordExpires = undefined;
    await doctor.save();
    await RefreshToken.deleteMany({ userId: doctor._id });
    res.status(200).json({ success: true, message: "Password reset successfully." });
    return;
  }

  res.status(400);
  throw new Error("This reset link is invalid or has expired.");
});

// ─────────────────────────────────────────────
// GET /auth/socket-token — Mints a short-lived JWT (same payload shape and
// secret as a normal access token, just a ~10 min expiry) that the web BFF
// hands to the browser so it can open a direct Socket.IO connection for
// WebRTC call signaling. The browser never sees the real access/refresh
// tokens; this token is scoped narrowly by its short lifetime.
// ─────────────────────────────────────────────
export const mintSocketToken = asyncHandler(async (req: Request, res: Response) => {
  const { id, role, name } = req.auth!;
  const token = jwt.sign({ id, role, name }, process.env.JWT_SECRET!, { expiresIn: "10m" });
  res.status(200).json({ success: true, data: { token } });
});
