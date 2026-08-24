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
  registerFcmToken,
  removeFcmToken,
  refreshToken,
  deleteMyAccount,
  requestAccountDeletionByCredentials,
  forgotPassword,
  resetPassword,
  mintSocketToken,
} from "../controllers/authController";
import { guestAuth, verifyToken, authorize } from "../middleware/auth";
import { keyByIdentifierOrIp } from "../middleware/rateLimit";

const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many login attempts. Please try again in 15 minutes." },
});

// Layered alongside loginLimiter above (both must pass), not a replacement:
// that one catches a high-volume flood from one source; this one catches a
// distributed brute-force against a single account spread across many IPs —
// something a pure per-IP limiter structurally cannot see.
const accountTargetedLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByIdentifierOrIp,
  message: { success: false, message: "Too many login attempts for this account. Please try again in 15 minutes." },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many registration attempts. Please try again in 1 hour." },
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByIdentifierOrIp,
  message: { success: false, message: "Too many reset requests for this email. Please try again in 15 minutes." },
});

// IP-only — the reset token itself (a 32-byte random value) is the real
// defense against guessing; this just caps raw request volume.
const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many attempts. Please try again in 15 minutes." },
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
authRouter.post("/login", loginLimiter, accountTargetedLoginLimiter, loginUser);

/**
 *  PUBLIC -login doctor
 */
authRouter.post("/doctor/login", loginLimiter, accountTargetedLoginLimiter, doctorLogin);

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

/**
 * PROTECTED - register raw FCM device token (for backgrounded/killed call ringing)
 */
authRouter.post("/register-fcm-token", guestAuth, verifyToken, registerFcmToken);

/**
 * PROTECTED - remove raw FCM device token
 */
authRouter.post("/remove-fcm-token", guestAuth, verifyToken, removeFcmToken);


authRouter.post("/refreshToken", refreshToken);

/**
 * PROTECTED - self-service account deletion (requires password confirmation)
 */
authRouter.delete("/me", guestAuth, verifyToken, deleteMyAccount);

/**
 * PUBLIC - web-based account deletion (email + password), for the
 * account-deletion page reachable without installing the app
 */
authRouter.post("/delete-by-credentials", loginLimiter, accountTargetedLoginLimiter, requestAccountDeletionByCredentials);

/**
 * PUBLIC - request a password reset email
 */
authRouter.post("/forgot-password", forgotPasswordLimiter, forgotPassword);

/**
 * PUBLIC - redeem a password reset token
 */
authRouter.post("/reset-password", resetPasswordLimiter, resetPassword);

/**
 * PROTECTED - mints a short-lived socket-auth token for the web BFF to hand
 * the browser, so it can open a direct Socket.IO connection for WebRTC
 * call signaling without ever holding the real access/refresh tokens.
 */
authRouter.get("/socket-token", guestAuth, verifyToken, authorize("Doctor", "User"), mintSocketToken);

export default authRouter;