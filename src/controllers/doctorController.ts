import { Request, Response } from "express";
import { Doctor, IDoctor } from "../models/doctor";
import asyncHandler from "../middleware/asyncHandler";
import { deleteFromCloudinary, uploadToCloudinary } from "../middleware/claudinary";
import mongoose from "mongoose";
import { IImage, Image } from "../models/image";
import bcrypt from "bcryptjs";

// GET all doctors — only approved doctors for public
export const getDoctors = asyncHandler(async (req: Request, res: Response) => {
  const doctors: IDoctor[] = await Doctor.find({ status: "approved" }).select("-passwordHash");
  res.status(200).json({ success: true, data: doctors });
});

// GET single doctor
export const getDoctor = asyncHandler(async (req: Request, res: Response) => {
  const doctor: IDoctor | null = await Doctor.findById(req.params.id).select("-passwordHash");
  if (!doctor) {
    res.status(404);
    throw new Error("Doctor not found");
  }

  // Only return if approved or user is admin
  if (doctor.status !== "approved" && req.auth?.role !== "Admin") {
    return res.status(403).json({ message: "Doctor profile not available" });
  }

  res.status(200).json({ success: true, data: doctor });
});

// CREATE doctor — self-registration defaults to 'submitted' AND handles image upload
export const createDoctor = asyncHandler(async (req: Request, res: Response) => {
  const { password, ...doctorData } = req.body; // Extract password

  // 1. Check for required image file
  if (!req.file) {
    res.status(400);
    throw new Error("Doctor profile image is required for registration.");
  }

  // 2. Hash Password (CRITICAL SECURITY STEP)
  if (!password) {
    res.status(400);
    throw new Error("Password is required.");
  }
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);

  let newImage: IImage | null = null;
  let newDoctor: IDoctor | null = null;

  try {
    // 3. Upload image to Cloudinary
    const { secure_url, public_id } = await uploadToCloudinary(
      req.file.buffer,
      "doctor-profiles"
    );

    // 4. Create new Image document
    newImage = await Image.create({
      imageUrl: secure_url,
      imageCldId: public_id,
      // uploadedBy will be set after doctor creation, or left null/undefined if not mandatory
    });

    // 5. Create Doctor document
    const createdDoctor = await Doctor.create({
      ...doctorData,
      passwordHash,
      // 🎯 FIX APPLIED HERE: Assert to 'unknown' first, then to mongoose.Types.ObjectId
      doctorImage: newImage._id as unknown as mongoose.Types.ObjectId,
      status: "submitted", // default on self-registration
    });

    newDoctor = createdDoctor as IDoctor;

    // 6. Update the Image document with the doctor's ID
    if (newImage && newDoctor._id) {
      // You might need the double assertion here too if newDoctor._id is a string type
      newImage.uploadedBy = newDoctor._id as unknown as mongoose.Types.ObjectId;
      await newImage.save();
    }
    // 7. Fetch final document for response
    // The result from findById is also a complex Mongoose type, assert it too.
    const responseDoctor = await Doctor.findById(newDoctor._id)
      .populate("doctorImage")
      .select("-passwordHash") as IDoctor; // <-- Assertion here as well

    res.status(201).json({
      success: true,
      data: responseDoctor,
      message: "Registration successful. Your profile is now under review."
    });

  } catch (error: any) {
    console.error("Doctor Registration Failed:", error.message);

    // CRITICAL: Cleanup if doctor creation failed but image upload succeeded
    if (newImage?.imageCldId) {
      await deleteFromCloudinary(newImage.imageCldId);
      await Image.findByIdAndDelete(newImage._id);
    }

    // If the error is a duplicate key error (e.g., email unique constraint), handle it
    if (error.code === 11000) {
      res.status(409);
      throw new Error("Registration failed: Email already in use.");
    }

    res.status(500);
    throw new Error(`Registration failed: ${error.message}`);
  }
});

// GET /api/v1/doctors/categories
export const getDoctorCategories = asyncHandler(async (req, res) => {
  const categories = await Doctor.aggregate([
    { $match: { status: "approved" } },
    { $group: { _id: "$specialization", count: { $sum: 1 } } },
    { $project: { specialization: "$_id", count: 1, _id: 0 } },
    { $sort: { count: -1 } },
  ]);
  res.status(200).json({ success: true, data: categories });
});

// GET logged-in doctor profile
export const getMyDoctorProfile = asyncHandler(async (req: Request, res: Response) => {
  if (!req.auth || req.auth.role !== "Doctor") {
    return res.status(403).json({ message: "Unauthorized" });
  }

  const doctor = await Doctor.findById(req.auth.id)
    .populate("doctorImage")
    .select("-passwordHash");

  if (!doctor) {
    res.status(404);
    throw new Error("Doctor not found");
  }

  res.status(200).json({ success: true, data: doctor });
});

// UPDATE Doctor Availability — doctor only
export const updateDoctorAvailability = asyncHandler(async (req: Request, res: Response) => {
  if (!req.auth || req.auth.role !== "Doctor") {
    return res.status(403).json({ message: "Unauthorized" });
  }
  console.log('[DoctorService] req.auth:', req.auth);


  const doctor = await Doctor.findById(req.auth.id);
  if (!doctor) {
    res.status(404);
    throw new Error("Doctor not found");
  }

  // Expected payload: { availability: { Monday: { from: "09:00", to: "17:00" }, ... } }
  doctor.availability = req.body.availability;
  await doctor.save();

  res.status(200).json({ success: true, data: doctor });
});

// UPDATE doctor — only admin can update status, doctor can update own profile
export const updateDoctor = asyncHandler(async (req: Request, res: Response) => {
  const doctor: IDoctor | null = await Doctor.findById(req.params.id).select("-passwordHash");

  if (!doctor) {
    res.status(404);
    throw new Error("Doctor not found");
  }

  // Doctor can only update their own profile
  if (req.auth?.role === "Doctor") {
    if (req.auth.id !== doctor._id?.toString()) {
      return res.status(403).json({ message: "You can only update your own profile" });
    }

    // Prevent doctors from changing status
    if (req.body.status) delete req.body.status;
  }

  const updates: any = { ...req.body };

  // ✅ Handle password change
  if (req.body.password) {
    const salt = await bcrypt.genSalt(10);
    updates.passwordHash = await bcrypt.hash(req.body.password, salt);
    delete updates.password;
  }

  // ✅ Handle profile image update
  if (req.file) {
    // Remove old image
    if (doctor.doctorImage) {
      const oldImage = await Image.findById(doctor.doctorImage);
      if (oldImage?.imageCldId) {
        await deleteFromCloudinary(oldImage.imageCldId);
        await Image.findByIdAndDelete(oldImage._id);
      }
    }

    // Upload new image
    const { secure_url, public_id } = await uploadToCloudinary(
      req.file.buffer,
      "doctor-profiles"
    );

    const newImage = await Image.create({
      imageUrl: secure_url,
      imageCldId: public_id,
      uploadedBy: doctor._id,
    });

    updates.doctorImage = newImage._id;
  }

  const updatedDoctor: IDoctor | null = await Doctor.findByIdAndUpdate(
    req.params.id,
    updates,
    { new: true, runValidators: true }
  )
    .populate("doctorImage")
    .select("-passwordHash");

  res.status(200).json({ success: true, data: updatedDoctor });
});

// DELETE doctor — only admin
export const deleteDoctor = asyncHandler(async (req: Request, res: Response) => {
  if (req.auth?.role !== "Admin") {
    return res.status(403).json({ message: "Only admin can delete doctors" });
  }

  const doctor = await Doctor.findByIdAndDelete(req.params.id);
  if (!doctor) {
    res.status(404);
    throw new Error("Doctor not found");
  }

  res.status(200).json({ success: true, message: "Doctor deleted successfully" });
});


// controllers/doctorController.ts
export const updateDoctorPushToken = async (req: Request, res: Response) => {
  try {
    const doctorId = req.auth!.id;
    const { expoPushToken } = req.body;

    const doctor = await Doctor.findById(doctorId);
    if (!doctor) {
      return res.status(404).json({ message: 'Doctor not found' });
    }

    // Add token if not already present
    if (!doctor.expoPushTokens?.includes(expoPushToken)) {
      doctor.expoPushTokens?.push(expoPushToken);
      await doctor.save();
    }

    res.json({ success: true, message: 'Push token updated' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};