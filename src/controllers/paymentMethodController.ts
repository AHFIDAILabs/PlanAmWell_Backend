import { Request, Response } from "express";
import asyncHandler from "../middleware/asyncHandler";
import { PaymentMethod } from "../models/paymentMethod";

export const getPaymentMethods = asyncHandler(async (req: Request, res: Response) => {
  const methods = await PaymentMethod.find({ userId: req.user.userId })
    .sort({ isDefault: -1, createdAt: -1 });

  res.json({ success: true, data: methods });
});

export const addPaymentMethod = asyncHandler(async (req: Request, res: Response) => {
  const { provider, type, last4, brand, expiryMonth, expiryYear, authorizationCode } = req.body;

  // unset previous default (optional)
  if (req.body.isDefault) {
    await PaymentMethod.updateMany(
      { userId: req.user.userId },
      { isDefault: false }
    );
  }

  const method = await PaymentMethod.create({
    userId: req.user.userId,
    provider,
    type,
    last4,
    brand,
    expiryMonth,
    expiryYear,
    authorizationCode,
    isDefault: req.body.isDefault ?? false,
  });

  res.status(201).json({ success: true, data: method });
});

export const updatePaymentMethod = asyncHandler(async (req: Request, res: Response) => {
  const method = await PaymentMethod.findOne({
    _id: req.params.id,
    userId: req.user.userId,
  });

  if (!method) return res.status(404).json({ message: "Not found" });

  if (req.body.isDefault === true) {
    await PaymentMethod.updateMany(
      { userId: req.user.userId },
      { isDefault: false }
    );
    method.isDefault = true;
  }

  await method.save();
  res.json({ success: true, data: method });
});


export const deletePaymentMethod = asyncHandler(async (req: Request, res: Response) => {
  const method = await PaymentMethod.findOneAndDelete({
    _id: req.params.id,
    userId: req.user.userId,
  });

  if (!method) {
    return res.status(404).json({ message: "Not found" });
  }

  res.json({ success: true });
});


