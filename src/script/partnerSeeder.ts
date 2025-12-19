// src/script/partnerSeeder.ts
import mongoose from "mongoose";
import dotenv from "dotenv";
import { Partner } from "../models/partner";

dotenv.config();
const MONGO_URI = process.env.MONGODB_URI || "";

const samplePartners = [
  {
    name: "Healthy Life Clinic",
    profession: "Healthcare Provider",
    businessAddress: "123 Wellness St, Lagos, Nigeria",
    partnerType: "business",
    email: "contact@healthylife.com",
    phone: "+2348012345678",
    website: "https://www.healthylife.com",
    socialLinks: [
      "https://twitter.com/healthylife",
      "https://facebook.com/healthylife"
    ],
    description: "A trusted clinic providing quality healthcare services.",
    isActive: true,
    createdBy: new mongoose.Types.ObjectId(),
  },
  {
    name: "Dr. Jane Doe",
    profession: "Gynecologist",
    businessAddress: "456 Care Ave, Abuja, Nigeria",
    partnerType: "individual",
    email: "jane.doe@example.com",
    phone: "+2348098765432",
    socialLinks: ["https://linkedin.com/in/janedoe"],
    description: "Experienced gynecologist with over 10 years of practice.",
    isActive: true,
    createdBy: new mongoose.Types.ObjectId(),
  },
  {
    name: "MedEquip Supplies",
    profession: "Medical Equipment Supplier",
    businessAddress: "789 Supply Rd, Lagos, Nigeria",
    partnerType: "business",
    email: "info@medequip.com",
    phone: "+2348123456789",
    website: "https://www.medequip.com",
    socialLinks: [
      "https://facebook.com/medequip",
      "https://twitter.com/medequip"
    ],
    description: "Supplier of high-quality medical equipment for clinics and hospitals.",
    isActive: true,
    createdBy: new mongoose.Types.ObjectId(),
  },
];

const seedPartners = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected to MongoDB");

    await Partner.deleteMany({});
    console.log("🗑️ Existing partners removed");

    await Partner.insertMany(samplePartners);
    console.log("✅ Sample partners inserted");

    process.exit(0);
  } catch (err) {
    console.error("❌ Seeding failed:", err);
    process.exit(1);
  }
};

seedPartners();
