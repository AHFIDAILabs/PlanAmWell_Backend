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
  // Set only on entries seeded/refreshed from OpenStreetMap (the clinic
  // pre-warm cron job or an on-demand live lookup) — absent on hospitals an
  // admin created directly. Lets upserts target "the OSM record for this
  // exact place" without touching admin-curated data, and lets read paths
  // tell the two apart if that's ever needed.
  osmId?: string;
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
    osmId: { type: String, unique: true, sparse: true },
  },
  { timestamps: true }
);

HospitalSchema.index(
  { name: "text", city: "text", state: "text", specialties: "text", services: "text" },
  { weights: { name: 10, specialties: 5, city: 3, state: 2 } }
);

// The clinic pre-warm job and the local-first nearby/by-city lookups
// (hospitalController.ts) now query by coordinates range on every request —
// this used to be an unindexed collection scan.
HospitalSchema.index({ "coordinates.latitude": 1, "coordinates.longitude": 1 });

export const Hospital = mongoose.model<IHospital>("Hospital", HospitalSchema);
