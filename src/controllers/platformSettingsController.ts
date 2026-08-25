// controllers/platformSettingsController.ts
import { Request, Response } from "express";
import asyncHandler from "../middleware/asyncHandler";
import { getPlatformSettings, updatePlatformSettings } from "../services/platformSettingsService";

/**
 * @desc Public config the apps need before booking — the flat consultation
 *       fee, plus whether the real payment step is currently active
 *       (PAYMENT_ENABLED — off until a real provider is configured, see the
 *       matching comment in appointmentController.createAppointment). Both
 *       apps check this before deciding whether to run the payment flow at
 *       all for a new booking.
 * @route GET /api/v1/platform-settings
 * @access Public
 */
export const getPlatformSettingsHandler = asyncHandler(async (_req: Request, res: Response) => {
  const settings = await getPlatformSettings();
  res.status(200).json({
    success: true,
    data: {
      consultationFeeKobo: settings.consultationFeeKobo,
      currency: settings.currency,
      paymentEnabled: process.env.PAYMENT_ENABLED === "true",
    },
  });
});

/**
 * @desc Update the flat consultation fee
 * @route PUT /api/v1/platform-settings
 * @access Admin
 */
export const updatePlatformSettingsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { consultationFeeKobo, currency } = req.body as { consultationFeeKobo?: number; currency?: string };

  if (consultationFeeKobo !== undefined && (typeof consultationFeeKobo !== "number" || consultationFeeKobo <= 0)) {
    res.status(400);
    throw new Error("consultationFeeKobo must be a positive number.");
  }

  const settings = await updatePlatformSettings({ consultationFeeKobo, currency }, req.auth?.id);
  res.status(200).json({
    success: true,
    data: { consultationFeeKobo: settings.consultationFeeKobo, currency: settings.currency },
  });
});
