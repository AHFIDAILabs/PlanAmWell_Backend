import mongoose, { Document, Schema } from "mongoose";

export interface IHospital extends Document {
  name: string;
  slug: string;
  type?: "public" | "private" | "NGO";
  address?: string;
  city?: string;
  state?: string;
  lga?: string;
  phone?: string;
  email?: string;
  website?: string;
  image?: string;
  services?: string[];
  specialties?: string[];
  openingHours?: string;
  isActive: boolean;
  rating: number;
  totalRatings: number;
  coordinates?: { latitude: number; longitude: number };
}

const HospitalSchema = new Schema<IHospital>(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, index: true, unique: true },
    type: { type: String, enum: ["public", "private", "NGO"], default: "private" },
    address: String,
    city: String,
    state: String,
    lga: String,
    phone: String,
    email: String,
    website: String,
    image: String,
    services: [String],
    specialties: [String],
    openingHours: { type: String, default: "Mon – Fri: 8am – 6pm" },
    isActive: { type: Boolean, default: true },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    totalRatings: { type: Number, default: 0 },
    coordinates: {
      latitude: { type: Number },
      longitude: { type: Number },
    },
  },
  { timestamps: true }
);

HospitalSchema.index(
  { name: "text", city: "text", state: "text", specialties: "text", services: "text" },
  { weights: { name: 10, specialties: 5, city: 3, state: 2 } }
);

export const Hospital = mongoose.model<IHospital>("Hospital", HospitalSchema);
