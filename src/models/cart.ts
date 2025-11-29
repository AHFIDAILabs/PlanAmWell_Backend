import mongoose, { Schema, Document, Types } from "mongoose";

export interface ICartItem {
  drugId: string;            
  quantity: number;
  price?: number;            
  specialInstructions?: string; 
  dosage?: string;  
  imageUrl?: string;
  drugName?: string;            
}

export interface ICart extends Document {
  userId?: Types.ObjectId;      // optional for guest carts
  sessionId?: string;           // optional for guest carts
  items: ICartItem[];
  totalItems: number;
  totalPrice: number;
  partnerCartId?: string;
  isAbandoned?: boolean;
}

const CartSchema = new Schema<ICart>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    sessionId: { type: String }, // for guests
    items: [
      {
        drugId: { type: String, required: true },
        quantity: { type: Number, required: true },
        price: { type: Number },
        dosage: { type: String, default: "" },
        specialInstructions: { type: String, default: "" },
        imageUrl: { type: String },
        drugName: { type: String}
      },
    ],
    totalItems: { type: Number, default: 0 },
    totalPrice: { type: Number, default: 0 },
    partnerCartId: { type: String },
    isAbandoned: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Add a compound index to ensure either userId or sessionId is unique per cart
CartSchema.index({ userId: 1 }, { unique: true, sparse: true });
CartSchema.index({ sessionId: 1 }, { unique: true, sparse: true });

export const Cart = mongoose.model<ICart>("Cart", CartSchema);
