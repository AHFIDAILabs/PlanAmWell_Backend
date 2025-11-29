import { Request, Response, NextFunction } from "express";

// Wraps an async route handler and forwards errors to the error handler
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
};

export default asyncHandler;
