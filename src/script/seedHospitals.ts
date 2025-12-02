// backend/script/seedHospitals.ts
import mongoose from "mongoose";
import dotenv from "dotenv";
import { Hospital } from "../models/hospital"; // create a simple Hospital model if absent

dotenv.config();

const sampleHospitals = [
  {
    name: "St. Mary's Women & Family Clinic",
    slug: "st-marys-women-clinic",
    address: "12 Ajose St, Lagos",
    phone: "+2347011110001",
    website: "https://stmarys.example.com",
    image: "https://images.unsplash.com/photo-1586773860418-3f9d8d8d5b2f?w=1200&q=80",
    services: ["OB/GYN", "Fertility", "Antenatal Care"],
  },
  {
    name: "Hope Fertility Center",
    slug: "hope-fertility-center",
    address: "45 Hospital Rd, Abuja",
    phone: "+2347011110002",
    website: "https://hopefertility.example.com",
    image: "https://images.unsplash.com/photo-1601573922611-9e23be3b77b6?w=1200&q=80",
    services: ["Fertility", "IVF"],
  },
];

const seedHospitals = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI!);
    console.log("✅ Connected to MongoDB");

    await Hospital.deleteMany({});
    console.log("🗑️ Cleared existing hospitals");

    const created = await Hospital.insertMany(sampleHospitals);
    console.log(`✅ Created ${created.length} hospitals`);
    process.exit(0);
  } catch (err) {
    console.error("❌ Seeder error:", err);
    process.exit(1);
  }
};

seedHospitals();
