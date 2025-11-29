// models/Image.ts - FIXED VERSION

import mongoose, { Document, Schema } from "mongoose";

export interface IImage extends Document {
  _id: mongoose.Types.ObjectId;
  imageUrl: string;      // ✅ Main property for Cloudinary URL
  imageCldId: string;    // ✅ Cloudinary public_id for deletion
  secure_url?: string;   // ✅ Optional: Alternative property name
  public_id?: string;    // ✅ Optional: Alternative property name
  uploadedBy?: mongoose.Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

const ImageSchema = new Schema<IImage>(
  {
    imageUrl: {
      type: String,
      required: true,
    },
    imageCldId: {
      type: String,
      required: true,
    },
    // Optional fields for flexibility
    secure_url: {
      type: String,
    },
    public_id: {
      type: String,
    },
    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { 
    timestamps: true,
    // ✅ Add virtuals to JSON output
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// ✅ Virtual to ensure secure_url is always available
ImageSchema.virtual('url').get(function() {
  return this.imageUrl || this.secure_url;
});

export const Image = mongoose.model<IImage>("Image", ImageSchema);