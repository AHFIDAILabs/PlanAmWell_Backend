import mongoose, { Document, Schema } from "mongoose";

export interface IReview extends Document {
  doctorId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  appointmentId?: mongoose.Types.ObjectId;
  name: string;
  rating: number;
  comment: string;
  createdAt?: Date;
}

const ReviewSchema = new Schema<IReview>({
  doctorId:      { type: Schema.Types.ObjectId, ref: "Doctor",      required: true },
  userId:        { type: Schema.Types.ObjectId, ref: "User",         required: true },
  appointmentId: { type: Schema.Types.ObjectId, ref: "Appointment" },
  name:          { type: String },
  rating:        { type: Number, min: 1, max: 5, default: 5 },
  comment:       { type: String },
}, { timestamps: true });

// One review per user per doctor
ReviewSchema.index({ userId: 1, doctorId: 1 }, { unique: true });

export const Review = mongoose.model<IReview>("Review", ReviewSchema);
