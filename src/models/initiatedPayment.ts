import mongoose, { Schema, Document } from "mongoose";

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
  createdAt?: Date;
  updatedAt?: Date;
}

const PaymentSchema = new Schema<IPayment>(
  {
    orderId: { type: String, required: true },
    userId: { type: String, required: true },
    paymentMethod: { type: String, required: true },
    partnerReferenceCode: { type: String, required: true },
    paymentReference: { type: String, required: true },
    transactionId: { type: String, required: true },
    checkoutUrl: { type: String, required: true },
    amount: { type: Number, required: true },
    status: { type: String, enum: ["pending", "success", "failed"], default: "pending" },
  },
  { timestamps: true }
);

export const Payment = mongoose.model<IPayment>("Payment", PaymentSchema);
