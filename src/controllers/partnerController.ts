// controllers/partnerController.ts
import { Request, Response } from "express";
import mongoose from "mongoose";
import { Partner, IPartner } from "../models/partner";
import { uploadToCloudinary, deleteFromCloudinary } from "../middleware/claudinary";
import { Image } from "../models/image";
import { IOrder, Order } from "../models/order";


// Extend Request type to include auth
interface AuthRequest extends Request {
  auth?: {
    id: string;
    role?: string;
    name?: string;
  };
}

/**
 * ===============================
 * CREATE PARTNER (ADMIN)
 * POST /api/partners
 * ===============================
 */
export const createPartner = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    console.log("📥 Received request body:", req.body);
    console.log("📥 Received file:", req.file);
    console.log("🔐 req.auth:", req.auth);
    
    // ✅ Get admin ID from req.auth (set by verifyAdminToken middleware)
    const adminId = req.auth?.id;
    
    console.log("🆔 Admin ID resolved to:", adminId);
    
    if (!adminId) {
      res.status(401).json({
        success: false,
        message: "Authentication failed: Admin ID not found. Please log in again.",
      });
      return;
    }

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
        imageUrl: uploadResult.secure_url,
        imageCldId: uploadResult.public_id,
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

    console.log("✅ Partner created successfully:", partner._id);

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
      .populate("createdBy", "firstName lastName email")
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
      .populate("createdBy", "firstName lastName email");

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
export const updatePartner = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { partnerId } = req.params;
    const adminId = req.auth?.id; // ✅ Use req.auth.id

    if (!adminId) {
      res.status(401).json({
        success: false,
        message: "Authentication failed: Admin ID not found",
      });
      return;
    }

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

        if (oldImage.imageCldId) {
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
        imageUrl: uploadResult.secure_url,
        imageCldId: uploadResult.public_id,
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

      if (image.imageCldId) {
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

/**
 * ===============================
 * GET ORDERS FOR A PARTNER (ADMIN)
 * GET /api/partners/:partnerId/orders
 * ===============================
 */

export const getPartnerOrders = async (req: Request, res: Response): Promise<void> => {
  try {
    const { partnerId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(partnerId)) {
      res.status(400).json({ success: false, message: "Invalid partner ID" });
      return;
    }

    // Populate userId and productId for first item image
    const orders = await Order.find({ partnerId })
      .populate("userId", "name email") // user info
      .populate("items.productId", "name image") // populate product info (optional: image)
      .sort({ createdAt: -1 });

    // Map orders to frontend-friendly format
   const formattedOrders = orders.map((order) => {
  const o = order as IOrder & { _id: mongoose.Types.ObjectId; createdAt: Date }; // cast

  return {
    id: o._id.toString(),
    orderId: o.orderNumber,
    totalPrice: o.total,
    status: o.deliveryStatus || "pending",
    platform: o.platform || "PlanAmWell",
    user: o.userId
      ? {
          name: (o.userId as any).name,
          origin: (o.userId as any).email,
        }
      : { name: "Guest", origin: "N/A" },
    itemCount: o.items.length,
    frontImage:
      o.items[0]?.productId && (o.items[0].productId as any).image
        ? (o.items[0].productId as any).image
        : null,
    createdAt: o.createdAt,
  };
});

    res.status(200).json({
      success: true,
      count: formattedOrders.length,
      data: formattedOrders,
    });
  } catch (error: any) {
    console.error("❌ getPartnerOrders error:", error);
    res
      .status(500)
      .json({ success: false, message: error.message || "Failed to fetch partner orders" });
  }
};
