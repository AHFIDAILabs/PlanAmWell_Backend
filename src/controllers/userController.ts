// controllers/userController.ts
import { Request, Response } from "express";
import { IUser } from "../types/index";
import { User } from "../models/user";
import { uploadToCloudinary, deleteFromCloudinary } from "../middleware/claudinary";
import { IImage, Image } from "../models/image";

import asyncHandler from "../middleware/asyncHandler";
import axios from "axios";
import mongoose from "mongoose";

const PARTNER_API_URL = process.env.PARTNER_API_URL || "";

// ------------------ GET Users (Admin Only) ------------------
export const getUsers = asyncHandler(async (req: Request, res: Response) => {
  if (req.auth?.role !== "Admin") {
    res.status(403);
    throw new Error("Forbidden - Admins only");
  }

  const users: IUser[] = await User.find().select("-password");
  res.status(200).json({ success: true, data: users });
});

// ------------------ GET Single User ------------------
export const getUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findById(req.params.id).select("-password");
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  // Regular users can only view their own profile
  if (req.auth?.role === "User" && req.auth.id !== req.params.id) {
    res.status(403);
    throw new Error("You can only view your own profile");
  }

  res.status(200).json({ success: true, data: user });
});


// ------------------ SYNC User With Partner (Checkout Flow Only) ------------------
// This is just a regular async function, no Express req/res
export const syncUserWithPartner = async (localUser: IUser) => {
  try {
    const response = await axios.post(`${PARTNER_API_URL}/accounts`, {
      name: localUser.name,
      email: localUser.email,
      phone: localUser.phone,
      role: "CLIENT",
      origin: "PlanAmWell",
    });

    // Return partner user ID for local mapping
    return response.data;
  } catch (err: any) {
    console.error("[UserController] Partner sync failed:", err.response?.data || err.message);
    return null;
  }
};


// ------------------ UPDATE User ------------------
export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  console.log("--- UPDATE PROFILE REQUEST RECEIVED ---");
  console.log("[Update] Starting update for User ID:", req.params.id, ". File present:", !!req.file);

  const user = await User.findById(req.params.id).populate("userImage");
  
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  // Users can only update their own profile
  if (req.auth?.role === "User" && req.auth.id !== req.params.id) {
    res.status(403);
    throw new Error("You can only update your own profile");
  }

  // Handle image upload if file is present
  if (req.file) {
    try {
      // Upload new image to Cloudinary
      const { secure_url, public_id } = await uploadToCloudinary(
        req.file.buffer,
        "user-profiles"
      );
      
      console.log("[Image] Uploaded new image. URL:", secure_url);

      // Delete old image from Cloudinary if exists
      if (user.userImage) {
        let oldImageId: mongoose.Types.ObjectId;
        let oldImageCldId: string | undefined;

        if (mongoose.Types.ObjectId.isValid(user.userImage as any)) {
          const oldImage = await Image.findById(user.userImage);
          oldImageId = oldImage?._id as mongoose.Types.ObjectId;
          oldImageCldId = oldImage?.imageCldId;
        } else {
          const oldImage = user.userImage as unknown as IImage;
          oldImageId = oldImage._id;
          oldImageCldId = oldImage.imageCldId;
        }

        if (oldImageCldId) {
          await deleteFromCloudinary(oldImageCldId);
          console.log("[Image] Deleted old Cloudinary image:", oldImageCldId);
        }
        
        await Image.findByIdAndDelete(oldImageId);
        console.log("[Image] Deleted old image document:", oldImageId);
      }

      // Create new image document
      const newImage = await Image.create({
        imageUrl: secure_url,
        imageCldId: public_id,
        uploadedBy: user._id,
      });

      console.log("[Image] Created new Image document ID:", newImage._id);

      // Update user with new image reference
      user.userImage = newImage._id as mongoose.Types.ObjectId;
    } catch (error: any) {
      console.error("[Image] Upload failed:", error.message);
      res.status(500);
      throw new Error(`Image upload failed: ${error.message}`);
    }
  }

  // Update other user fields from request body
  const allowedUpdates: (keyof IUser)[] = [
    "name",
    "phone",
    "email",
    "gender",
    "dateOfBirth",
    "homeAddress",
    "city",
    "state",
    "lga",
    "preferences",
  ];

  allowedUpdates.forEach((field) => {
    if (req.body[field] !== undefined) {
      (user as any)[field] = req.body[field];
    }
  });

  console.log("[Update] Saving user document...");
  await user.save();
  console.log("[Update] User document saved.");

  // ✅ CRITICAL: Populate userImage before sending response
  await user.populate("userImage");

  console.log("[Response] Final Image URL sent:", 
    user.userImage && typeof user.userImage === 'object' 
      ? (user.userImage as any).imageUrl 
      : 'Not populated'
  );

  res.status(200).json({ 
    success: true, 
    data: user,
    message: "Profile updated successfully" 
  });
});


/**
 * Delete User Profile Image
 * @route DELETE /api/users/:id/image
 * @access Private
 */
export const deleteUserImage = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findById(req.params.id).populate("userImage");
  
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  // Users can only delete their own image
  if (req.auth?.role === "User" && req.auth.id !== req.params.id) {
    res.status(403);
    throw new Error("You can only delete your own profile image");
  }

  if (!user.userImage) {
    res.status(404);
    throw new Error("No profile image to delete");
  }

  try {
    let imageToDelete: IImage | null = null;

    if (mongoose.Types.ObjectId.isValid(user.userImage as any)) {
      imageToDelete = await Image.findById(user.userImage);
    } else {
      imageToDelete = user.userImage as unknown as IImage;
    }
    
    if (imageToDelete?.imageCldId) {
      await deleteFromCloudinary(imageToDelete.imageCldId);
    }
    
    await Image.findByIdAndDelete(imageToDelete?._id);
    
    user.userImage = undefined;
    await user.save();

    res.status(200).json({ 
      success: true, 
      message: "Profile image deleted successfully" 
    });
  } catch (error: any) {
    res.status(500);
    throw new Error(`Failed to delete image: ${error.message}`);
  }
});

/** ------------------ GET USER PROFILE ------------------ */
export const getUserProfile = asyncHandler(async (req: Request, res: Response) => {
  console.log("📋 Fetching user profile for:", req.auth?.id);
  
  const user = await User.findById(req.auth?.id)
    .populate("userImage") // ✅ POPULATE userImage
    .select("-password");

  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  console.log("✅ User profile found");
  console.log("🖼️ UserImage populated:", {
    exists: !!user.userImage,
    type: typeof user.userImage,
    isPopulated: user.userImage && typeof user.userImage === 'object' && '_id' in user.userImage
  });

  res.status(200).json({
    success: true,
    data: user,
  });
});


// ------------------ DELETE User (Admin Only) ------------------
export const deleteUser = asyncHandler(async (req: Request, res: Response) => {
  if (req.auth?.role !== "Admin") {
    res.status(403);
    throw new Error("Forbidden - Admins only");
  }

  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  res.status(200).json({ success: true, message: "User deleted successfully" });
});
