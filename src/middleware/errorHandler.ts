import { Request, Response, NextFunction } from "express";

// CommonJS export
export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  console.error("❌ Error:", err.message);

  // Determine status code
  const statusCode = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;

  res.status(statusCode).json({
    success: false,
    message: err.message || "Internal Server Error",
    // Include stack trace only in development mode
    stack: process.env.NODE_ENV === "production" ? undefined : err.stack,
  });
};


