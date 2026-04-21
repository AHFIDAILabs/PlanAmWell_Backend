import mongoose, { Schema, Document, Types } from "mongoose";

export interface IPayment extends Document {
  orderId: string;
  userId: string;
  paymentMethod: "card" | "paystack" | "bank_transfer";
  partnerReferenceCode: string;
  paymentReference: string;
  transactionId: string;
  checkoutUrl: string;
  amount: number;
  status: "pending" | "success" | "failed";
  provider?: string;
  rawResponse?: any;
  createdAt?: Date;
  updatedAt?: Date;
}

const PaymentSchema = new Schema<IPayment>(
  {
    orderId: { type: String, ref: "Order", required: true },
    userId: { type: String, ref: "User", required: true },
    paymentMethod: { type: String, required: true },
    partnerReferenceCode: { type: String, required: true },
    paymentReference: { type: String, required: true },
    transactionId: { type: String, required: true },
    checkoutUrl: { type: String, required: true },
    amount: { type: Number, required: true },
    status: {
      type: String,
      enum: ["pending", "success", "failed"],
      default: "pending",
    },
    provider: { type: String, default: "partner" },
    rawResponse: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

// ✅ One pending payment per order
PaymentSchema.index(
  { orderId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "pending" } }
);

// ✅ Global uniqueness
PaymentSchema.index({ paymentReference: 1 }, { unique: true });
PaymentSchema.index({ transactionId: 1 }, { unique: true });

export const Payment = mongoose.model<IPayment>("Payment", PaymentSchema);