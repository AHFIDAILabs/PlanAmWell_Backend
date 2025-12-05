import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

import { User } from "../models/user";
import { Doctor } from "../models/doctor";
import { Admin } from "../models/admin";    // ✅ ADDED
import { RefreshToken } from "../models/refreshToken";
import { Session } from "../models/sessions";

// -------------------- ENV CHECK --------------------
if (!process.env.JWT_SECRET || !process.env.REFRESH_TOKEN_SECRET) {
  throw new Error("JWT_SECRET or REFRESH_TOKEN_SECRET missing from .env");
}

// -------------------- Extend Express Request --------------------
declare module "express" {
  interface Request {
    auth?: {
      id?: string;
      role?: string;
      name?: string;
      sessionId?: string;
      isAnonymous?: boolean;
    };
    user?: any;
    session?: any;
  }
}

interface JwtPayload {
  id?: string;
  role?: string;
  name?: string;
  sessionId?: string;
  isAnonymous?: boolean;
}

// =======================================================
//               🔐 JWT GENERATION (UPDATED)
// =======================================================

export const signJwt = (entity: any) => {
  // Guest sessions
  if (entity.isAnonymous && entity._id) {
    return jwt.sign(
      { sessionId: entity._id.toString(), isAnonymous: true },
      process.env.JWT_SECRET!,
      { expiresIn: "7d" }
    );
  }

  // ---- FIX: ADMIN ROLE SUPPORT ----
  const role =
    entity.role ||
    (entity.email && entity.password && entity.firstName && entity.lastName
      ? "Admin"
      : entity.specialization
      ? "Doctor"
      : "User");

  const payload: JwtPayload = {
    id: entity.userId?.toString() || entity._id?.toString() || entity.id,
    role,
    name:
      entity.name ||
      `${entity.firstName || ""} ${entity.lastName || ""}`.trim(),
  };

  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: "7d" });
};

// =======================================================
//                🔄 REFRESH TOKEN
// =======================================================

export const signRefreshToken = async (entity: any) => {
  const payload = { id: entity._id.toString(), role: entity.role || "User" };
  const token = jwt.sign(payload, process.env.REFRESH_TOKEN_SECRET!, {
    expiresIn: "7d",
  });

  const salt = await bcrypt.genSalt(10);
  const hashedToken = await bcrypt.hash(token, salt);

  await RefreshToken.create({
    token: hashedToken,
    userId: entity._id,
    userType: entity.role || "User",
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  return { token, hashedToken };
};

// =======================================================
//               🛂 GUEST / AUTH MIDDLEWARE
// =======================================================

export const guestAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    console.log("\n[guestAuth] ---- START ----");
    const authHeader = req.headers.authorization;
    console.log("[guestAuth] Authorization header:", authHeader);

    if (!authHeader?.startsWith("Bearer ")) {
      console.warn("[guestAuth] No Bearer token found in header");
      return next();
    }

    const token = authHeader.split(" ")[1];
    console.log("[guestAuth] Token extracted:", token);

    let decoded: JwtPayload | null = null;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
      console.log("[guestAuth] JWT decoded:", decoded);
    } catch (err) {
      console.error("[guestAuth] JWT verification failed:", err);
      return next(); // let verifyToken handle the 401
    }

    if (!decoded?.id) {
      console.warn("[guestAuth] Decoded JWT has no id");
      return next();
    }

    // Find the entity in DB
    const entity =
      (await User.findById(decoded.id).select("-password")) ||
      (await Doctor.findById(decoded.id).select("-password")) ||
      (await Admin.findById(decoded.id).select("-password"));
    console.log("[guestAuth] Entity found in DB:", entity);

    if (!entity) {
      console.warn("[guestAuth] No user/doctor/admin found for this ID");
      return next();
    }

    // Ensure role is set properly
    const role = entity.role || decoded.role || "User";

    req.user = entity;
    req.auth = {
      ...decoded,
      id: decoded.id,
      role,
      name: entity.name || `${entity.firstName} ${entity.lastName}`.trim(),
      isAnonymous: false,
    };

    console.log("[guestAuth] req.auth set:", req.auth);
    console.log("[guestAuth] ---- END ----\n");

    next();
  } catch (err) {
    console.error("[guestAuth] Unexpected error:", err);
    next(err);
  }
};


// =======================================================
//                🔐 FULL AUTH REQUIRED
// =======================================================

export const verifyToken = (req: Request, res: Response, next: NextFunction) => {
  console.log("[verifyToken] req.auth:", req.auth);
  if (!req.auth || req.auth.isAnonymous) {
    console.warn("[verifyToken] Unauthorized - Login required");
    return res.status(401).json({ message: "Unauthorized - Login required" });
  }
  console.log("[verifyToken] Token valid, proceeding...");
  next();
};

// =======================================================
//               🎭 ROLE-BASED ACCESS
// =======================================================

export const authorize = (...allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    console.log("[authorize] req.auth:", req.auth);
    console.log("[authorize] allowedRoles:", allowedRoles);
    if (!req.auth || !allowedRoles.includes(req.auth.role!)) {
      console.warn("[authorize] Forbidden - insufficient role");
      return res.status(403).json({ message: "Forbidden - Insufficient role" });
    }
    console.log("[authorize] Role authorized, proceeding...");
    next();
  };
};

// =======================================================
//                🔁 REFRESH TOKEN CHECKS
// =======================================================

export const verifyRefreshToken = (token: string) =>
  jwt.verify(token, process.env.REFRESH_TOKEN_SECRET!);

export const revokeToken = async (token: string) => {
  const decoded: any = verifyRefreshToken(token);
  const savedTokens = await RefreshToken.find({ userId: decoded.id });

  for (const saved of savedTokens) {
    const match = await bcrypt.compare(token, saved.token);
    if (match) {
      await RefreshToken.deleteOne({ _id: saved._id });
      return true;
    }
  }
  throw new Error("Token not found or already revoked");
};

// =======================================================
//                 🧬 HYDRATE USER (UPDATED)
// =======================================================

export const hydrateUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.auth?.id)
      return res.status(401).json({ message: "Unauthorized - Not authenticated" });

    const entity =
      (await User.findById(req.auth.id).select("-password").lean()) ||
      (await Doctor.findById(req.auth.id).select("-password").lean()) ||
      (await Admin.findById(req.auth.id).select("-password").lean()); // ✅ ADMIN SUPPORT

    if (!entity) return res.status(404).json({ message: "User/Doctor/Admin not found" });

    req.user = entity;
    next();
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

export default {
  signJwt,
  signRefreshToken,
  verifyToken,
  guestAuth,
  authorize,
  verifyRefreshToken,
  revokeToken,
  hydrateUser,
};
