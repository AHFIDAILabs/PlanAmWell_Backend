import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  createGuestSession,
  convertGuestToUser,
  getCurrentUser,
  createUser,
  loginUser,
  doctorLogin,
  registerPushToken,
  removePushToken,
  refreshToken,
  deleteMyAccount,
} from "../controllers/authController";
import { guestAuth, verifyToken } from "../middleware/auth";

const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many login attempts. Please try again in 15 minutes." },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many registration attempts. Please try again in 1 hour." },
});

/**
 * PUBLIC - create a guest session
 */
authRouter.post("/guest", createGuestSession);

/**
 * PUBLIC - register a new user
 */
authRouter.post("/register", registerLimiter, createUser);

/**
 * PUBLIC - login user
 */
authRouter.post("/login", loginLimiter, loginUser);

/**
 *  PUBLIC -login doctor
 */
authRouter.post("/doctor/login", loginLimiter, doctorLogin);

/**
 * GUEST USER - convert guest session to registered user
 */
authRouter.post("/convert", convertGuestToUser);

/**
 * PROTECTED - get current user info
 */
authRouter.get("/me", getCurrentUser);

/**
 * PROTECTED - register Expo push token
 */
authRouter.post("/register-push-token", guestAuth, verifyToken, registerPushToken);

/**
 * PROTECTED - remove Expo push token
 */
authRouter.post("/remove-push-token", guestAuth, verifyToken, removePushToken);


authRouter.post("/refreshToken", refreshToken);

/**
 * PROTECTED - self-service account deletion (requires password confirmation)
 */
authRouter.delete("/me", guestAuth, verifyToken, deleteMyAccount);

export default authRouter;