import { Router } from "express";
import { createGuestSession, convertGuestToUser, getCurrentUser, createUser, loginUser, doctorLogin } from "../controllers/authController";

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

export default authRouter;