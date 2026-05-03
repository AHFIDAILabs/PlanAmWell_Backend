import { Router } from "express";
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
import { guestAuth, verifyToken } from "../middleware/auth"; // Make sure you have this middleware

const authRouter = Router();

/**
 * PUBLIC - create a guest session
 */
authRouter.post("/guest", createGuestSession);

/**
 * PUBLIC - register a new user
 */
authRouter.post("/register", createUser);

/**
 * PUBLIC - login user
 */
authRouter.post("/login", loginUser);  

/**
 *  PUBLIC -login doctor
 */
authRouter.post("/doctor/login", doctorLogin);

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