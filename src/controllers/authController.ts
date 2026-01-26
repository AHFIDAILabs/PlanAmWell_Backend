import { Request, Response } from "express";
import { Types } from "mongoose";
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

if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET missing from .env");


// -------------------- Guest User --------------------

// POST /auth/guest
export const createGuestSession = asyncHandler(async (req: Request, res: Response) => {
  const session = await Session.create({ isAnonymous: true });
  const token = signJwt({ sessionId: session._id, isAnonymous: true });

  res.status(201).json({
    success: true,
    sessionId: session._id,
    token,
    isAnonymous: true,
  });
});


// -------------------- Push Token Management --------------------

/**
 * 📲 Register Expo push token
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

  const user = await User.findById(userId);
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  // Use the helper method from your User model
  await user.addExpoPushToken(token);

  // console.log(`[PushToken] Registered token for user ${userId}`);
  
  res.status(200).json({ 
    success: true, 
    message: "Push token registered successfully" 
  });
});

/**
 * 🗑️ Remove Expo push token (on logout)
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

  const user = await User.findById(userId);
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  // Use the helper method from your User model
  await user.removeExpoPushToken(token);

  // console.log(`[PushToken] Removed token for user ${userId}`);
  
  res.status(200).json({ 
    success: true, 
    message: "Push token removed successfully" 
  });
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
    cart.userId = newUser._id as Types.ObjectId;
    cart.sessionId = undefined; // Clear sessionId to avoid confusion/conflicts
    await cart.save();
  }

  const token = signJwt({ userId: newUser._id, sessionId: session._id, role: "User" });

  res.status(201).json({
    success: true,
    token,
    user: newUser,
    sessionId: session._id,
  });
});

// ------------------ CREATE User (Local Only) ------------------

export const createUser = asyncHandler(async (req: Request, res: Response) => {
  // Prevent creating user if already logged in
  if (req.auth?.id) {
    res.status(400);
    throw new Error("Already logged in, cannot create new account");
  }

  const { name, email, phone, password, dateOfBirth, city, state, homeAddress, lga, roles } = req.body;

  // Check if email exists locally
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return res.status(409).json({
      success: false,
      message: "User with this email already exists locally",
    });
  }

  // Create new user
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
    roles: roles || ["User"],
    verified: true,
  });

  // Populate relations (userImage, others if needed)
  const fullUser = await User.findById(newUser._id).populate("userImage");

  const userResponse = fullUser?.toObject({ virtuals: true });

  // Remove password from response
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
    // 1️⃣ Decode JWT
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
    const storedTokens = await RefreshToken.find({ userId: user._id });

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

    // 5️⃣ Rotate refresh token (optional but recommended)
    await RefreshToken.deleteOne({ _id: matchedToken._id });
    const { token: newRefreshToken } = await signRefreshToken(user);

    // 6️⃣ Generate new access token
    const newAccessToken = signJwt(user);

    res.status(200).json({
      success: true,
      token: newAccessToken,
      refreshToken: newRefreshToken, // send rotated refresh token
    });
  } catch (err: any) {
    console.error("Refresh Token Error:", err.message);
    res.status(401);
    throw new Error("Invalid or expired refresh token");
  }
});
