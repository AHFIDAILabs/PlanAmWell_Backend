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

  // Populate userImage if exists
  const userWithImage = await User.findById(newUser._id).populate("userImage");

  // Prepare response object
  const userResponse = userWithImage?.toObject({ virtuals: true }) || newUser.toObject({ virtuals: true });
  res.status(201).json({ success: true, data: userResponse });
});


// ------------------- Login User -------------------
// POST /auth/login
export const loginUser = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  // Find user and populate userImage
  const user = await User.findOne({ email }).select("+password").populate("userImage");

  if (!user) return res.status(401).json({ message: "Invalid credentials" });

  const isMatch = await (user as any).comparePassword(password);
  if (!isMatch) return res.status(401).json({ message: "Invalid credentials" });

  // Generate JWT
  const token = signJwt(user);

  // Convert user to object and remove password
  const userResponse = user.toObject({ virtuals: true });
  delete userResponse.password;

  res.status(200).json({
    success: true,
    token,
    user: userResponse, // includes populated userImage
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
    throw new Error("Please provide both email and password");
  }

  // 1. Find the Doctor by email
  const doctor = await Doctor.findOne({ email });

  if (!doctor) {
    res.status(401);
    throw new Error("Invalid Credentials");
  }

  // 2. Check Password Hash
  const isMatch = await bcrypt.compare(password, doctor.passwordHash);

  if (!isMatch) {
    res.status(401);
    throw new Error("Invalid Credentials");
  }

  // 3. Authorization Check: Ensure the doctor is APPROVED
  if (doctor.status !== "approved") {
    res.status(403);
    const message =
      doctor.status === "submitted" || doctor.status === "reviewing"
        ? "Your account is pending verification and approval by the admin."
        : "Your account is not active. Please contact support.";
    throw new Error(message);
  }

  // 4. Generate Tokens
  const token = signJwt(doctor);
  const { token: refreshToken } = await signRefreshToken(doctor);

  // 5. Send Response
  res.status(200).json({
    success: true,
    message: "Doctor logged in successfully",
    token,
    refreshToken,
    user: { // Return necessary profile info, excluding password hash
        _id: doctor._id,
        firstName: doctor.firstName,
        lastName: doctor.lastName,
        email: doctor.email,
        specialization: doctor.specialization,
        status: doctor.status,
        role: "Doctor", // Explicitly set role
    },
  });
});

// -------------------- Protected User Routes Example --------------------

// GET /auth/me
export const getCurrentUser = asyncHandler(async (req: Request & { user?: any }, res: Response) => {
  if (!req.user) return res.status(401).json({ message: "Unauthorized" });
  res.status(200).json({ success: true, user: req.user });
});
