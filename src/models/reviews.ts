// backend/models/review.ts
import mongoose, { Document, Schema } from "mongoose";

export interface IReview extends Document {
  doctorId: mongoose.Types.ObjectId;
  name: string;
  rating: number;
  comment: string;
  createdAt?: Date;
}

const ReviewSchema = new Schema<IReview>({
  doctorId: { type: Schema.Types.ObjectId, ref: "Doctor", required: true },
  name: String,
  rating: { type: Number, min: 1, max: 5, default: 5 },
  comment: String,
}, { timestamps: true });

export const Review = mongoose.model<IReview>("Review", ReviewSchema);
