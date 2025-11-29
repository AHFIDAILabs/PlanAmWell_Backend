import mongoose, { Schema, Document } from "mongoose";

export interface IProduct extends Document {
  partnerId: string;         // internal DB reference (ObjectId)
  partnerProductId: string;  // UUID from partner API
  drugId: string;            // same as partnerProductId, used in cart/checkout
  name: string;
  sku: string;
  imageUrl: string;
  categoryName: string;
  prescriptionRequired: boolean;
  manufacturerName: string;
  price: number;
  expired: Date | null;
  stockQuantity: number;
  status: string;
}

const ProductSchema = new Schema(
  {
    partnerProductId: { type: String, required: true, unique: true },
    drugId: { type: String, required: true, unique: true }, // mapped to partnerProductId
    name: { type: String, required: true },
    sku: { type: String },
    imageUrl: { type: String },
    categoryName: { type: String },
    prescriptionRequired: { type: Boolean, default: false },
    manufacturerName: { type: String },
    price: { type: Number, required: true },
    expired: { type: Date, default: null },
    stockQuantity: { type: Number, default: 0 },
    status: { type: String },
  },
  { timestamps: true }
);

export const Product = mongoose.model<IProduct>("Product", ProductSchema);
