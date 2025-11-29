import { Request, Response, NextFunction } from "express";
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
import { User } from "../models/user";
import { Doctor } from "../models/doctor";
import { RefreshToken } from "../models/refreshToken";
import { Session } from "../models/sessions";

if (!process.env.JWT_SECRET || !process.env.REFRESH_TOKEN_SECRET) {
  throw new Error("JWT_SECRET or REFRESH_TOKEN_SECRET missing from .env");
}

// Extend Express Request
declare module "express" {
  interface Request {
    auth?: { id?: string; role?: string; name?: string; sessionId?: string; isAnonymous?: boolean };
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

// -------------------- JWT Helpers --------------------

// NOTE: Ensure your payload for guest sessions uses 'sessionId' and the payload for full users uses 'id'.
export const signJwt = (entity: any) => {
  // Handle guest sessions
  if (entity.isAnonymous && entity._id) {
    return jwt.sign(
      { sessionId: entity._id.toString(), isAnonymous: true }, 
      process.env.JWT_SECRET, 
      { expiresIn: "7d" }
    );
  }

  // ✅ Handle both entity objects and plain payloads
  const payload: JwtPayload = {
    id: entity.userId?.toString() || entity._id?.toString() || entity.id, // ← Support userId, _id, or id
    role: entity.role || (entity.specialization ? "Doctor" : "User"),
    name: entity.name || `${entity.firstName || ""} ${entity.lastName || ""}`.trim(),
  };
  
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "7d" });
};
export const signRefreshToken = async (entity: any) => {
  const payload = { id: entity._id.toString(), role: entity.role || "User" };
  const token = jwt.sign(payload, process.env.REFRESH_TOKEN_SECRET, { expiresIn: "7d" });

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

// -------------------- Guest & Auth Middleware (RECTIFIED) --------------------

export const guestAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    console.log("🔐 guestAuth middleware - Auth header:", authHeader ? `${authHeader.substring(0, 40)}...` : "NONE");
    
    let decoded: JwtPayload | null = null;
    
    // 1. Attempt to decode token from Authorization header
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      console.log("   Token extracted, length:", token?.length);
      
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET) as JwtPayload;
        console.log("   ✅ Token decoded successfully:", { id: decoded.id, role: decoded.role, sessionId: decoded.sessionId });
      } catch (err: any) {
        console.error("   ❌ Token verification failed:", err.message);
        // Do not stop here; fall through to check request parameters
      }
    }

    // 2. Handle Decoded Token (Full User or Guest Session)
    if (decoded) {
      // Full user authentication
      if (decoded.id) {
        console.log("   Looking up user by ID:", decoded.id);
        const entity =
          (await User.findById(decoded.id).select("-password")) ||
          (await Doctor.findById(decoded.id).select("-password"));
        
        if (entity) {
          console.log("   ✅ User found:", entity._id);
          req.user = entity;
          req.auth = { ...decoded, isAnonymous: false, id: decoded.id, role: entity.role || "User" };
        } else {
          console.log("   ❌ User not found for ID:", decoded.id);
        }
      } 
      // Guest session
      else if (decoded.sessionId) {
        console.log("   Guest session detected:", decoded.sessionId);
        const session = await Session.findById(decoded.sessionId);
        if (session) req.session = session;
        req.auth = { sessionId: decoded.sessionId, isAnonymous: true };
      }
    }
    
    // 3. Fallback: Check for sessionId in Query/Body
    if (!req.auth?.id && !req.auth?.sessionId) {
      const sessionIdFromRequest = req.query.sessionId || req.body.sessionId;
      
      if (sessionIdFromRequest && typeof sessionIdFromRequest === 'string') {
        console.log("   Checking fallback sessionId from request:", sessionIdFromRequest);
        const session = await Session.findById(sessionIdFromRequest);
        
        if (session) {
          req.session = session;
          req.auth = { sessionId: sessionIdFromRequest, isAnonymous: true };
        }
      }
    }

    console.log("   Final req.auth:", req.auth);
    next();
  } catch (err) {
    console.error("💥 Guest/Auth Middleware Fatal Error:", err);
    next();
  }
};
// -------------------- Full Auth Required --------------------

export const verifyToken = async (req: Request, res: Response, next: NextFunction) => {
  if (!req.auth || req.auth.isAnonymous) {
    return res.status(401).json({ message: "Unauthorized - Login required" });
  }
  next();
};

// -------------------- Role-based Authorization --------------------

export const authorize = (...allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth || !allowedRoles.includes(req.auth.role!)) {
      return res.status(403).json({ message: "Forbidden - Insufficient role" });
    }
    next();
  };
};

// -------------------- Refresh Token --------------------

export const verifyRefreshToken = (token: string) => jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);

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

// -------------------- Hydrate User --------------------

export const hydrateUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.auth?.id) return res.status(401).json({ message: "Unauthorized - Not authenticated" });

    const entity =
      (await User.findById(req.auth.id).select("-password").lean()) ||
      (await Doctor.findById(req.auth.id).select("-password").lean());

    if (!entity) return res.status(404).json({ message: "User/Doctor not found" });

    req.user = entity;
    next();
  } catch (err) {
    console.error("[Auth Middleware] hydrateUser error:", err);
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