// controllers/partnerController.ts
import { Request, Response } from "express";
import mongoose from "mongoose";
import { Partner, IPartner } from "../models/partner";
import { uploadToCloudinary, deleteFromCloudinary } from "../middleware/claudinary";
import { Image } from "../models/image";

/**
 * ===============================
 * CREATE PARTNER (ADMIN)
 * POST /api/partners
 * ===============================
 */
export const createPartner = async (req: Request, res: Response): Promise<void> => {
  try {
    console.log("📥 Received request body:", req.body);
    console.log("📥 Received file:", req.file);
    
    const adminId = req.user?.id;
    let imageId: mongoose.Types.ObjectId | undefined;

    // Handle socialLinks - it might come as array or need parsing
    let socialLinks = req.body.socialLinks;
    if (typeof socialLinks === 'string') {
      try {
        socialLinks = JSON.parse(socialLinks);
      } catch (e) {
        socialLinks = [socialLinks];
      }
    }

    // 📤 Upload image if provided
    if (req.file?.buffer) {
      const uploadResult = await uploadToCloudinary(
        req.file.buffer,
        "partners"
      );

      const image = await Image.create({
        imageUrl: uploadResult.secure_url,      // ✅ Changed from 'url'
        imageCldId: uploadResult.public_id,     // ✅ Changed from 'publicId'
        createdBy: adminId,
      });

      imageId = image._id;
    }

    const partner = await Partner.create({
      ...req.body,
      socialLinks,
      partnerImage: imageId,
      createdBy: adminId,
    });

    res.status(201).json({
      success: true,
      message: "Partner created successfully",
      data: partner,
    });
  } catch (error: any) {
    console.error("❌ Create partner error:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Failed to create partner",
    });
  }
};

/**
 * ===============================
 * GET ALL PARTNERS (ADMIN)
 * GET /api/partners
 * ===============================
 */
export const getAllPartners = async (req: Request, res: Response): Promise<void> => {
  try {
    const { isActive, partnerType, profession, search } = req.query;

    const filter: any = {};

    if (isActive !== undefined) filter.isActive = isActive === "true";
    if (partnerType) filter.partnerType = partnerType;
    if (profession) filter.profession = profession;

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { profession: { $regex: search, $options: "i" } },
      ];
    }

    const partners = await Partner.find(filter)
      .populate("partnerImage")
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: partners.length,
      data: partners,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch partners",
    });
  }
};

/**
 * ===============================
 * GET ACTIVE PARTNERS (PUBLIC)
 * GET /api/partners/active
 * ===============================
 */
export const getActivePartners = async (_req: Request, res: Response): Promise<void> => {
  try {
    const partners = await Partner.find({ isActive: true })
      .populate("partnerImage")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: partners.length,
      data: partners,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch active partners",
    });
  }
};

/**
 * ===============================
 * GET PARTNER BY ID (ADMIN)
 * GET /api/partners/:partnerId
 * ===============================
 */
export const getPartnerById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { partnerId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(partnerId)) {
      res.status(400).json({ success: false, message: "Invalid partner ID" });
      return;
    }

    const partner = await Partner.findById(partnerId)
      .populate("partnerImage")
      .populate("createdBy", "name email");

    if (!partner) {
      res.status(404).json({ success: false, message: "Partner not found" });
      return;
    }

    res.status(200).json({
      success: true,
      data: partner,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch partner",
    });
  }
};

/**
 * ===============================
 * UPDATE PARTNER (ADMIN)
 * PUT /api/partners/:partnerId
 * ===============================
 */
export const updatePartner = async (req: Request, res: Response): Promise<void> => {
  try {
    const { partnerId } = req.params;
    const adminId = req.user?.id;

    if (!mongoose.Types.ObjectId.isValid(partnerId)) {
      res.status(400).json({ success: false, message: "Invalid partner ID" });
      return;
    }

    const partner = await Partner.findById(partnerId).populate("partnerImage");

    if (!partner) {
      res.status(404).json({ success: false, message: "Partner not found" });
      return;
    }

    // Handle socialLinks
    let socialLinks = req.body.socialLinks;
    if (typeof socialLinks === 'string') {
      try {
        socialLinks = JSON.parse(socialLinks);
      } catch (e) {
        socialLinks = [socialLinks];
      }
    }

    // 🖼️ If new image uploaded → replace old one
    if (req.file?.buffer) {
      // Delete old image from Cloudinary
      if (partner.partnerImage && typeof partner.partnerImage !== "string") {
        const oldImage = partner.partnerImage as any;

        if (oldImage.imageCldId) {                    // ✅ Changed from 'publicId'
          await deleteFromCloudinary(oldImage.imageCldId);
        }

        await Image.findByIdAndDelete(oldImage._id);
      }

      // Upload new image
      const uploadResult = await uploadToCloudinary(
        req.file.buffer,
        "partners"
      );

      const newImage = await Image.create({
        imageUrl: uploadResult.secure_url,          // ✅ Changed from 'url'
        imageCldId: uploadResult.public_id,         // ✅ Changed from 'publicId'
        createdBy: adminId,
      });

      partner.partnerImage = newImage._id;
    }

    // Update other fields
    Object.assign(partner, { ...req.body, socialLinks });
    await partner.save();

    res.status(200).json({
      success: true,
      message: "Partner updated successfully",
      data: partner,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Failed to update partner",
    });
  }
};

/**
 * ===============================
 * DELETE PARTNER (ADMIN)
 * DELETE /api/partners/:partnerId
 * ===============================
 */
export const deletePartner = async (req: Request, res: Response): Promise<void> => {
  try {
    const { partnerId } = req.params;

    const partner = await Partner.findById(partnerId).populate("partnerImage");

    if (!partner) {
      res.status(404).json({ success: false, message: "Partner not found" });
      return;
    }

    // Delete image if exists
    if (partner.partnerImage && typeof partner.partnerImage !== "string") {
      const image = partner.partnerImage as any;

      if (image.imageCldId) {                       // ✅ Changed from 'publicId'
        await deleteFromCloudinary(image.imageCldId);
      }

      await Image.findByIdAndDelete(image._id);
    }

    await partner.deleteOne();

    res.status(200).json({
      success: true,
      message: "Partner deleted successfully",
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message || "Failed to delete partner",
    });
  }
};

/**
 * ===============================
 * TOGGLE PARTNER STATUS (ADMIN)
 * PATCH /api/partners/:partnerId/toggle-status
 * ===============================
 */
export const togglePartnerStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { partnerId } = req.params;

    const partner = await Partner.findById(partnerId);

    if (!partner) {
      res.status(404).json({ success: false, message: "Partner not found" });
      return;
    }

    partner.isActive = !partner.isActive;
    await partner.save();

    res.status(200).json({
      success: true,
      message: `Partner ${partner.isActive ? "activated" : "deactivated"} successfully`,
      data: partner,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message || "Failed to toggle partner status",
    });
  }
};

/**
 * ===============================
 * PARTNER STATS (ADMIN)
 * GET /api/partners/stats
 * ===============================
 */
export const getPartnerStats = async (_req: Request, res: Response): Promise<void> => {
  try {
    const total = await Partner.countDocuments();
    const active = await Partner.countDocuments({ isActive: true });
    const inactive = await Partner.countDocuments({ isActive: false });

    const byType = await Partner.aggregate([
      { $group: { _id: "$partnerType", count: { $sum: 1 } } },
    ]);

    res.status(200).json({
      success: true,
      data: {
        total,
        active,
        inactive,
        byType,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch partner stats",
    });
  }
};