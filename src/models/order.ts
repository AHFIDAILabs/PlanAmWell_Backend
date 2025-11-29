import mongoose, { Document, Schema, Types } from "mongoose";
import { v4 as uuidv4 } from "uuid";

export interface IOrderItem {
  productId: Types.ObjectId; // local reference to Product
  name?: string;
  sku?: string;
  qty: number;
  price: number;
  dosage?: string; // optional, for API
  specialInstructions?: string; // optional, for API
}

export interface IOrder extends Document {
  orderNumber: string;
  sessionId?: string;
  userId?: Types.ObjectId;
  partnerOrderId?: string;         // partner order mapping
  isThirdPartyOrder?: boolean;     // true if created via partner API
  platform?: string;               // e.g., "PlanAmWell" or "mymedicine"
  items: IOrderItem[];
  subtotal: number;
  shippingFee?: number;
  total: number;
  paymentStatus: "pending" | "paid" | "failed" | "refunded";
  deliveryStatus?: "pending" | "shipped" | "delivered" | "cancelled";
  shippingAddress?: {
    name?: string;
    phone?: string;
    addressLine?: string;
    city?: string;
    state?: string;
  };
  discreetPackaging?: boolean;
}

const OrderItemSchema = new Schema<IOrderItem>(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    name: String,
    sku: String,
    qty: { type: Number, required: true },
    price: { type: Number, required: true },
    dosage: String,
    specialInstructions: String,
  },
  { _id: false }
);

const OrderSchema = new Schema<IOrder>(
  {
    orderNumber: { type: String, required: true, unique: true, default: uuidv4 },
    sessionId: String,
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    partnerOrderId: { type: String },         // partner system order ID
    isThirdPartyOrder: { type: Boolean, default: false },
    platform: { type: String, default: "PlanAmWell" },
    items: { type: [OrderItemSchema], required: true },
    subtotal: { type: Number, required: true },
    shippingFee: { type: Number, default: 0 },
    total: { type: Number, required: true },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded"],
      default: "pending",
    },
    deliveryStatus: {
      type: String,
      enum: ["pending", "shipped", "delivered", "cancelled"],
      default: "pending",
    },
    shippingAddress: {
      name: String,
      phone: String,
      addressLine: String,
      city: String,
      state: String,
    },
    discreetPackaging: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const Order = mongoose.model<IOrder>("Order", OrderSchema);
