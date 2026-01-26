// middleware/auth.ts - UPDATED WITH ADMIN SEPARATION
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
//               🔐 JWT GENERATION (FIXED FOR ADMIN)
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

  // ✅ FIXED: Explicitly detect Admin by checking the collection/model
  let role = "User"; // default
  
  // Check if this is an Admin instance
  if (entity.constructor?.modelName === "Admin" || 
      (entity.roles && Array.isArray(entity.roles) && entity.roles.includes("Admin"))) {
    role = "Admin";
    // console.log("🔐 [signJwt] Detected Admin user");
  } 
  // Check if entity has explicit role
  else if (entity.role) {
    role = entity.role;
  } 
  // Check for Doctor-specific fields
  else if (entity.specialization || entity.licenseNumber) {
    role = "Doctor";
  }
  // Check for Admin-specific structure (firstName/lastName but no 'name')
  else if (entity.email && entity.password && entity.firstName && !entity.name) {
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

  // console.log("🔐 [signJwt] Generated token with payload:", payload);

  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: "7d" });
};

// =======================================================
//          🔐 ADMIN-SPECIFIC JWT GENERATION
// =======================================================

export const signAdminJwt = (admin: any) => {
  const payload: JwtPayload = {
    id: admin._id?.toString() || admin.id,
    role: "Admin", // Always set to Admin
    name: `${admin.firstName || ""} ${admin.lastName || ""}`.trim() || "Admin",
  };

  // console.log("🔐 [signAdminJwt] Generated ADMIN token with payload:", payload);

  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: "7d" });
};

// =======================================================
//                🔄 REFRESH TOKEN
// =======================================================

export const signRefreshToken = async (entity: any) => {
  // Determine role more accurately
  let role = "User";
  
  if (entity.constructor?.modelName === "Admin" || 
      (entity.roles && entity.roles.includes("Admin"))) {
    role = "Admin";
  } else if (entity.role) {
    role = entity.role;
  } else if (entity.specialization) {
    role = "Doctor";
  }
  
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
      // console.log("🔓 [guestAuth] No token provided, continuing as guest");
      return next();
    }

    const token = authHeader.split(" ")[1];
    let decoded: JwtPayload | null = null;

    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
      // console.log("✅ [guestAuth] Token decoded:", {
      //   id: decoded.id,
      //   role: decoded.role,
      //   isAnonymous: decoded.isAnonymous,
      // });
    } catch (err) {
       console.log("⚠️ [guestAuth] Token verification failed, continuing as guest");
      return next();
    }

    // Handle anonymous sessions
    if (decoded.isAnonymous && decoded.sessionId) {
      req.auth = { sessionId: decoded.sessionId, isAnonymous: true };
      // console.log("👤 [guestAuth] Anonymous session set");
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
        // console.log("⚠️ [guestAuth] User not found for ID:", decoded.id);
        return next();
      }

      // Use role from token (which should be correct now)
      req.user = user;
      req.auth = {
        id: decoded.id,
        role: decoded.role || "User",
        name: decoded.name || "User",
        isAnonymous: false,
      };

      // console.log("✅ [guestAuth] User authenticated:", {
      //   id: req.auth.id,
      //   role: req.auth.role,
      // });
    }

    next();
  } catch (err) {
    console.error("❌ [guestAuth] Error:", err);
    next(err);
  }
};

// =======================================================
//                🔐 FULL AUTH REQUIRED
// =======================================================

export const verifyToken = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // console.log("🔑 [verifyToken] Checking authentication...");

  // Check if guestAuth already populated req.auth
  if (req.auth?.id && !req.auth.isAnonymous) {
    // console.log("✅ [verifyToken] Already authenticated via guestAuth");
    // console.log("✅ [verifyToken] req.auth:", req.auth);
    return next();
  }

  // Otherwise, try to extract token manually
  const authHeader = req.headers.authorization;
  
  if (!authHeader?.startsWith("Bearer ")) {
    // console.log("❌ [verifyToken] No Bearer token found");
    return res
      .status(401)
      .json({ message: "Unauthorized - No token provided" });
  }

  const token = authHeader.split(" ")[1];
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
    
    // console.log("✅ [verifyToken] Token decoded successfully:", {
    //   id: decoded.id,
    //   role: decoded.role,
    // });

    req.auth = {
      id: decoded.id,
      role: decoded.role,
      name: decoded.name,
      isAnonymous: decoded.isAnonymous || false,
    };

    // console.log("✅ [verifyToken] req.auth set:", req.auth);
    next();
  } catch (err: any) {
    console.log("❌ [verifyToken] Token verification failed:", err.message);
    return res
      .status(401)
      .json({ message: "Unauthorized - Invalid or expired token" });
  }
};

// =======================================================
//        🔐 ADMIN-SPECIFIC VERIFICATION
// =======================================================

export const verifyAdminToken = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // console.log("👑 [verifyAdminToken] Checking admin authentication...");

  const authHeader = req.headers.authorization;
  
  if (!authHeader?.startsWith("Bearer ")) {
    // console.log("❌ [verifyAdminToken] No Bearer token found");
    return res
      .status(401)
      .json({ message: "Unauthorized - No token provided" });
  }

  const token = authHeader.split(" ")[1];
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
    
    // console.log("✅ [verifyAdminToken] Token decoded:", {
    //   id: decoded.id,
    //   role: decoded.role,
    // });

    // ✅ Explicitly check for Admin role
    if (decoded.role !== "Admin") {
      // console.log("❌ [verifyAdminToken] User is not an Admin:", decoded.role);
      return res
        .status(403)
        .json({ message: "Forbidden - Admin access required" });
    }

    req.auth = {
      id: decoded.id,
      role: decoded.role,
      name: decoded.name,
      isAnonymous: false,
    };

    // console.log("✅ [verifyAdminToken] Admin authenticated:", req.auth);
    next();
  } catch (err: any) {
    console.log("❌ [verifyAdminToken] Token verification failed:", err.message);
    return res
      .status(401)
      .json({ message: "Unauthorized - Invalid or expired token" });
  }
};

// =======================================================
//               🎭 ROLE-BASED ACCESS
// =======================================================

export const authorize = (...allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // console.log("🎭 [authorize] Checking role authorization...");
    // console.log("🎭 [authorize] req.auth:", req.auth);
    // console.log("🎭 [authorize] allowedRoles:", allowedRoles);

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

    // console.log("✅ [authorize] Role authorized, proceeding...");
    next();
  };
};

// =======================================================
//                🔁 REFRESH TOKEN CHECKS
// =======================================================

export const verifyRefreshToken = async (token: string) => {
  const decoded: any = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET!);

  const tokens = await RefreshToken.find({ userId: decoded.id });

  for (const t of tokens) {
    const match = await bcrypt.compare(token, t.token);
    if (match) return { decoded, dbToken: t };
  }

  throw new Error("Refresh token not found");
};

export const revokeToken = async (token: string) => {
  const decoded: any = await verifyRefreshToken(token);
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
//                 🧬 HYDRATE USER
// =======================================================

export const hydrateUser = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // console.log("🧬 [hydrateUser] Hydrating user...");
    // console.log("🧬 [hydrateUser] req.auth:", req.auth);

    if (!req.auth?.id) {
      // console.log("❌ [hydrateUser] No auth ID found");
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
      // console.log("❌ [hydrateUser] Entity not found for ID:", req.auth.id);
      return res
        .status(404)
        .json({ message: "User/Doctor/Admin not found" });
    }

    // console.log("✅ [hydrateUser] Entity found");

    req.user = entity;
    next();
  } catch (err) {
    console.error("❌ [hydrateUser] Error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export default {
  signJwt,
  signAdminJwt,
  signRefreshToken,
  verifyToken,
  verifyAdminToken,
  guestAuth,
  authorize,
  verifyRefreshToken,
  revokeToken,
  hydrateUser,
  verifyJwtToken,
};