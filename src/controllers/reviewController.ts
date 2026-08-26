import { Request, Response } from "express";
import { Review } from "../models/reviews";
import { Doctor } from "../models/doctor";
import { Appointment } from "../models/appointment";
import { User } from "../models/user";
import { io } from "../index";
import { memoryCache } from "../util/memoryCache";
import { APPROVED_DOCTORS_CACHE_KEY } from "./doctorController";

// GET /api/v1/reviews/doctor/:doctorId
export const getDoctorReviews = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { doctorId } = req.params;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, parseInt(req.query.limit as string) || 10);

    const [reviews, total] = await Promise.all([
      Review.find({ doctorId })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Review.countDocuments({ doctorId }),
    ]);

    return res.json({ success: true, data: { reviews, total, page, limit } });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to fetch reviews" });
  }
};

// GET /api/v1/reviews/can-review/:doctorId
export const checkCanReview = async (req: Request, res: Response): Promise<Response> => {
  try {
    const userId = req.auth?.id;
    const { doctorId } = req.params;

    const [completedAppt, existingReview] = await Promise.all([
      Appointment.findOne({ userId, doctorId, status: "completed" }),
      Review.findOne({ userId, doctorId }),
    ]);

    return res.json({
      success: true,
      data: {
        canReview: !!completedAppt && !existingReview,
        hasReviewed: !!existingReview,
        hasCompleted: !!completedAppt,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Check failed" });
  }
};

// POST /api/v1/reviews
export const submitReview = async (req: Request, res: Response): Promise<Response> => {
  try {
    const userId = req.auth?.id;
    const { doctorId, rating, comment, appointmentId } = req.body;

    if (!doctorId || !rating) {
      return res.status(400).json({ success: false, message: "doctorId and rating are required" });
    }

    // Verify completed appointment
    const completedAppt = await Appointment.findOne({ userId, doctorId, status: "completed" });
    if (!completedAppt) {
      return res.status(403).json({
        success: false,
        message: "You can only review doctors after a completed appointment",
      });
    }

    // Prevent duplicate
    const existing = await Review.findOne({ userId, doctorId });
    if (existing) {
      return res.status(409).json({ success: false, message: "You have already reviewed this doctor" });
    }

    // Get reviewer's name
    let reviewerName = "Patient";
    const userDoc = await User.findById(userId).select("name").lean();
    if (userDoc?.name) reviewerName = userDoc.name;

    const review = await Review.create({
      doctorId,
      userId,
      appointmentId: appointmentId || completedAppt._id,
      name: reviewerName,
      rating: Math.min(5, Math.max(1, Number(rating))),
      comment: comment?.trim() || "",
    });

    // Recompute doctor average rating
    const agg = await Review.aggregate([
      { $match: { doctorId: review.doctorId } },
      { $group: { _id: null, avg: { $avg: "$rating" }, count: { $sum: 1 } } },
    ]);

    const newAvg = agg[0] ? Math.round(agg[0].avg * 10) / 10 : rating;
    const newCount = agg[0]?.count ?? 1;
    await Doctor.findByIdAndUpdate(doctorId, { ratings: newAvg, reviewCount: newCount });

    // getDoctors caches the approved-doctor list for up to 10 minutes — that
    // cache was never invalidated here, so a new rating/review count could
    // take up to 10 minutes to show up in the doctor list after being saved.
    memoryCache.invalidate(APPROVED_DOCTORS_CACHE_KEY);

    // Real-time: notify the doctor's room
    io.to(`user_${doctorId}`).emit("doctor-new-review", {
      doctorId,
      review: {
        _id:       review._id,
        name:      review.name,
        rating:    review.rating,
        comment:   review.comment,
        createdAt: review.createdAt,
      },
      newAvgRating: newAvg,
    });

    return res.status(201).json({ success: true, data: { review, newAvgRating: newAvg } });
  } catch (err: any) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: "You have already reviewed this doctor" });
    }
    return res.status(500).json({ success: false, message: "Failed to submit review" });
  }
};
