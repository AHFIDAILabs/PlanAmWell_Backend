import { Router } from "express";
import { getDoctorReviews, checkCanReview, submitReview } from "../controllers/reviewController";
import { verifyToken, guestAuth } from "../middleware/auth";

const reviewRouter = Router();

// Public — anyone can read reviews
reviewRouter.get("/doctor/:doctorId", guestAuth, getDoctorReviews);

// Auth-only
reviewRouter.get("/can-review/:doctorId", verifyToken, checkCanReview);
reviewRouter.post("/", verifyToken, submitReview);

export default reviewRouter;
