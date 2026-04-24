import mongoose, { Schema, Document, Types } from "mongoose";

export interface ICartItem {
  drugId: string; // ✅ Partner UUID (product.drugId = product.partnerProductId)
  quantity: number;
  price?: number;
  dosage?: string;
  specialInstructions?: string;
  imageUrl?: string;
  drugName?: string;
}

export interface ICart extends Document {
  userId?: string;
  sessionId?: string;
  items: ICartItem[];
  totalItems: number;
  totalPrice: number;
  partnerCartId?: string;
  isAbandoned?: boolean;
  status?: string
}

const CartSchema = new Schema<ICart>(
  {
    userId: { type: String },
    sessionId: { type: String },
    items: [
      {
        drugId: { type: String, required: true },
        quantity: { type: Number, required: true },
        price: { type: Number },
        dosage: { type: String, default: "" },
        specialInstructions: { type: String, default: "" },
        imageUrl: { type: String },
        drugName: { type: String },
      },
    ],
    totalItems: { type: Number, default: 0 },
    totalPrice: { type: Number, default: 0 },
    partnerCartId: { type: String },
    isAbandoned: { type: Boolean, default: false },
    status: { type: String, enum: ["active", "checked_out"], default: "active" },
  },
  { timestamps: true },
);

CartSchema.index({ userId: 1 }, { unique: true, sparse: true });
CartSchema.index({ sessionId: 1 }, { unique: true, sparse: true });

export const Cart = mongoose.model<ICart>("Cart", CartSchema);
