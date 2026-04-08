// models/paymentMethod.ts
import mongoose, { Schema, Document, Types } from "mongoose";

export interface IPaymentMethod extends Document {
  userId: Types.ObjectId;
  provider: "paystack" | "stripe";
  type: "card" | "bank";
  last4: string;
  brand?: string;
  expiryMonth?: number;
  expiryYear?: number;
  authorizationCode: string; // provider token
  isDefault: boolean;
  createdAt?: Date;
}

const PaymentMethodSchema = new Schema<IPaymentMethod>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    provider: { type: String, required: true },
    type: { type: String, enum: ["card", "bank"], required: true },
    last4: { type: String, required: true },
    brand: String,
    expiryMonth: Number,
    expiryYear: Number,
    authorizationCode: { type: String, required: true },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// ✅ One default method per user
PaymentMethodSchema.index(
  { userId: 1, isDefault: 1 },
  { unique: true, partialFilterExpression: { isDefault: true } }
);

export const PaymentMethod = mongoose.model<IPaymentMethod>(
  "PaymentMethod",
  PaymentMethodSchema
);