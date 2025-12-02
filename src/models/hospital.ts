// backend/models/hospital.ts
import mongoose, { Document, Schema } from "mongoose";

export interface IHospital extends Document {
  name: string;
  slug: string;
  address?: string;
  phone?: string;
  website?: string;
  image?: string;
  services?: string[];
}

const HospitalSchema = new Schema<IHospital>({
  name: { type: String, required: true },
  slug: { type: String, required: true, index: true, unique: true },
  address: String,
  phone: String,
  website: String,
  image: String,
  services: [String],
}, { timestamps: true });

export const Hospital = mongoose.model<IHospital>("Hospital", HospitalSchema);
