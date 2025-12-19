// middleware/auth.ts - FIXED VERSION
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

import { User } from "../models/user";
import { Doctor } from "../models/doctor";
import { Admin } from "../models/admin";
import { RefreshToken } from "../models/refreshToken";

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
//               🔐 JWT GENERATION (FIXED)
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

  // ✅ FIXED: Determine role correctly
  let role = "User"; // default

  if (entity.role) {
    // If entity already has a role, use it
    role = entity.role;
  } else if (entity.specialization || entity.licenseNumber) {
    // If it has doctor-specific fields
    role = "Doctor";
  } else if (entity.email && entity.password && !entity.name) {
    // Admin typically has firstName/lastName but not "name" field
    role = "Admin";
  }

  const payload: JwtPayload = {
    id: entity.userId?.toString() || entity._id?.toString() || entity.id,
    role,
    name:
      entity.name ||
      `${entity.firstName || ""} ${entity.lastName || ""}`.trim() ||
      "User",
  };

  console.log("🔐 [signJwt] Generated token with payload:", payload);

  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: "7d" });
};

// =======================================================
//                🔄 REFRESH TOKEN
// =======================================================

export const signRefreshToken = async (entity: any) => {
  const role = entity.role || (entity.specialization ? "Doctor" : "User");
  const payload = { id: entity._id.toString(), role };
  
  const token = jwt.sign(payload, process.env.REFRESH_TOKEN_SECRET!, {
    expiresIn: "7d",
  });

  const salt = await bcrypt.genSalt(10);
  const hashedToken = await bcrypt.hash(token, salt);

  await RefreshToken.create({
    token: hashedToken,
    userId: entity._id,
    userType: role,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  return { token, hashedToken };
};

export const verifyJwtToken = (token: string) => {
  if (!token) throw new Error("Token required");

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
    return decoded;
  } catch (err) {
    throw new Error("Invalid token");
  }
};

// =======================================================
//               🛂 GUEST / AUTH MIDDLEWARE
// =======================================================

export const guestAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    
    // If no token, continue as guest
    if (!authHeader?.startsWith("Bearer ")) {
      console.log("🔓 [guestAuth] No token provided, continuing as guest");
      return next();
    }

    const token = authHeader.split(" ")[1];
    let decoded: JwtPayload | null = null;

    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
      console.log("✅ [guestAuth] Token decoded:", {
        id: decoded.id,
        role: decoded.role,
        isAnonymous: decoded.isAnonymous,
      });
    } catch (err) {
      console.log("⚠️ [guestAuth] Token verification failed, continuing as guest");
      return next(); // Invalid token -> let verifyToken handle if needed
    }

    // Handle anonymous sessions
    if (decoded.isAnonymous && decoded.sessionId) {
      req.auth = { sessionId: decoded.sessionId, isAnonymous: true };
      console.log("👤 [guestAuth] Anonymous session set");
      return next();
    }

    // Handle authenticated users
    if (decoded.id) {
      // Try to find user in any collection
      const user =
        (await User.findById(decoded.id).select("-password")) ||
        (await Doctor.findById(decoded.id).select("-passwordHash")) ||
        (await Admin.findById(decoded.id).select("-password"));

      if (!user) {
        console.log("⚠️ [guestAuth] User not found for ID:", decoded.id);
        return next();
      }

      // ✅ FIXED: Properly determine role from user object
      let userRole = decoded.role;
      if (!userRole) {
        if ((user as any).specialization) {
          userRole = "Doctor";
        } else if ((user as any).roles?.includes("Admin")) {
          userRole = "Admin";
        } else {
          userRole = "User";
        }
      }

      req.user = user;
      req.auth = {
        id: decoded.id,
        role: userRole,
        name:
          user.name ||
          `${user.firstName || ""} ${user.lastName || ""}`.trim() ||
          "User",
        isAnonymous: false,
      };

      console.log("✅ [guestAuth] User authenticated:", {
        id: req.auth.id,
        role: req.auth.role,
      });
    }

    next();
  } catch (err) {
    console.error("❌ [guestAuth] Error:", err);
    next(err);
  }
};

// =======================================================
//                🔐 FULL AUTH REQUIRED (FIXED)
// =======================================================

export const verifyToken = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.log("🔑 [verifyToken] Checking authentication...");
  console.log("🔑 [verifyToken] req.auth before check:", req.auth);

  // ✅ FIXED: Check if guestAuth already populated req.auth
  if (req.auth?.id && !req.auth.isAnonymous) {
    console.log("✅ [verifyToken] Already authenticated via guestAuth");
    return next();
  }

  // Otherwise, try to extract token manually
  const authHeader = req.headers.authorization;
  
  if (!authHeader?.startsWith("Bearer ")) {
    console.log("❌ [verifyToken] No Bearer token found");
    return res
      .status(401)
      .json({ message: "Unauthorized - No token provided" });
  }

  const token = authHeader.split(" ")[1];
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
    
    console.log("✅ [verifyToken] Token decoded successfully:", {
      id: decoded.id,
      role: decoded.role,
    });

    // ✅ FIXED: Attach complete auth object
    req.auth = {
      id: decoded.id,
      role: decoded.role,
      name: decoded.name,
      isAnonymous: decoded.isAnonymous || false,
    };

    console.log("✅ [verifyToken] req.auth set:", req.auth);
    next();
  } catch (err: any) {
    console.log("❌ [verifyToken] Token verification failed:", err.message);
    return res
      .status(401)
      .json({ message: "Unauthorized - Invalid or expired token" });
  }
};

// =======================================================
//               🎭 ROLE-BASED ACCESS (IMPROVED)
// =======================================================

export const authorize = (...allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    console.log("🎭 [authorize] Checking role authorization...");
    console.log("🎭 [authorize] req.auth:", req.auth);
    console.log("🎭 [authorize] allowedRoles:", allowedRoles);

    if (!req.auth || !req.auth.role) {
      console.warn("❌ [authorize] No auth or role found");
      return res
        .status(403)
        .json({ message: "Forbidden - No authentication" });
    }

    if (!allowedRoles.includes(req.auth.role)) {
      console.warn(
        `❌ [authorize] Role '${req.auth.role}' not in allowed roles:`,
        allowedRoles
      );
      return res
        .status(403)
        .json({ message: "Forbidden - Insufficient permissions" });
    }

    console.log("✅ [authorize] Role authorized, proceeding...");
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
//                 🧬 HYDRATE USER (FIXED)
// =======================================================

export const hydrateUser = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    console.log("🧬 [hydrateUser] Hydrating user...");
    console.log("🧬 [hydrateUser] req.auth:", req.auth);

    if (!req.auth?.id) {
      console.log("❌ [hydrateUser] No auth ID found");
      return res
        .status(401)
        .json({ message: "Unauthorized - Not authenticated" });
    }

    // Try to find in all collections
    const entity =
      (await User.findById(req.auth.id).select("-password").lean()) ||
      (await Doctor.findById(req.auth.id).select("-passwordHash").lean()) ||
      (await Admin.findById(req.auth.id).select("-password").lean());

    if (!entity) {
      console.log("❌ [hydrateUser] Entity not found for ID:", req.auth.id);
      return res
        .status(404)
        .json({ message: "User/Doctor/Admin not found" });
    }

    console.log("✅ [hydrateUser] Entity found:", {
      id: entity._id,
      type: (entity as any).specialization
        ? "Doctor"
        : (entity as any).roles?.includes("Admin")
        ? "Admin"
        : "User",
    });

    req.user = entity;
    next();
  } catch (err) {
    console.error("❌ [hydrateUser] Error:", err);
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
  verifyJwtToken,
};