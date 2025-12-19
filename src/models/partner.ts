// models/partner.ts
import mongoose, { Document, Schema } from "mongoose";
import { IImage } from "./image"; 

export interface IPartner extends Document {
  name: string; // Works for both business and personal names
  socialLinks: string[]; // Array of social media links
  profession: string; // e.g., "Healthcare Provider", "Medical Equipment Supplier", etc.
  businessAddress: string;
  partnerImage?: IImage | mongoose.Types.ObjectId; // Optional image reference
  partnerType: "individual" | "business"; // To distinguish between personal and business partners
  email?: string; // Optional contact email
  phone?: string; // Optional contact phone
  description?: string; // Optional description about the partner
  website?: string; // Optional website URL
  isActive: boolean; // To enable/disable partners
  createdBy: mongoose.Types.ObjectId; // Reference to Admin who created this
  createdAt: Date;
  updatedAt: Date;
}

const PartnerSchema: Schema = new Schema(
  {
    name: {
      type: String,
      required: [true, "Partner name is required"],
      trim: true,
      maxlength: [100, "Name cannot exceed 100 characters"],
    },
    socialLinks: {
      type: [String],
      default: [],
      validate: {
        validator: function (links: string[]) {
          // Validate that each link is a valid URL
          const urlPattern = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/;
          return links.every(link => urlPattern.test(link));
        },
        message: "All social links must be valid URLs",
      },
    },
    profession: {
      type: String,
      required: [true, "Profession is required"],
      trim: true,
      maxlength: [100, "Profession cannot exceed 100 characters"],
    },
    businessAddress: {
      type: String,
      required: [true, "Business address is required"],
      trim: true,
      maxlength: [300, "Address cannot exceed 300 characters"],
    },
    partnerImage: {
      type: Schema.Types.ObjectId,
      ref: "Image", // Assuming you have an Image model
      default: null,
    },
    partnerType: {
      type: String,
      enum: ["individual", "business"],
      required: [true, "Partner type is required"],
      default: "business",
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
        "Please provide a valid email address",
      ],
    },
    phone: {
      type: String,
      trim: true,
      match: [
        /^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$/,
        "Please provide a valid phone number",
      ],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, "Description cannot exceed 1000 characters"],
    },
    website: {
      type: String,
      trim: true,
      match: [
        /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/,
        "Please provide a valid website URL",
      ],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      required: [true, "Admin reference is required"],
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for better query performance
PartnerSchema.index({ name: 1 });
PartnerSchema.index({ profession: 1 });
PartnerSchema.index({ isActive: 1 });
PartnerSchema.index({ partnerType: 1 });

PartnerSchema.virtual("formattedCreatedAt").get(function (this: IPartner) {
  return this.createdAt.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
});


// Ensure virtuals are included when converting to JSON
PartnerSchema.set("toJSON", { virtuals: true });
PartnerSchema.set("toObject", { virtuals: true });

export const Partner = mongoose.model<IPartner>("Partner", PartnerSchema);