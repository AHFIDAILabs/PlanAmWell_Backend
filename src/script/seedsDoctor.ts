import mongoose from "mongoose";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { Doctor } from "../models/doctor";

dotenv.config();

// Random utilities
const rand = (arr: any[]) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

// Generate random Nigerian names
const firstNames = ["Aisha", "Funke", "Bisi", "Chioma", "Tunde", "Amaka", "Zainab", "Yemi", "Ada", "Kemi", "Rukayat", "Fatima"];
const lastNames = ["Bello", "Adeyemi", "Okafor", "Eze", "Olawale", "Balogun", "Ojo", "Mohammed", "Chukwu", "Adebayo"];

// Medical fields
const specializations = [
  "OB/GYN",
  "Endocrinologist",
  "Fertility Specialist",
  "Sexual Health Educator",
  "Pediatrician",
  "General Practitioner",
  "Cardiologist",
  "Dermatologist",
  "Neurologist",
];

// Random online profile images (always safe)
const profileImages = [
  "https://images.unsplash.com/photo-1537368910025-700350fe46c7?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1524503033411-c9566986fc8f?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1594824476967-48c8b964273b?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1607746882042-944635dfe10e?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1559839731-2b71ea197ec2?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1612349317150-d9c33c1b8a9a?auto=format&fit=crop&w=800&q=80",
];

// Sample bios
const bios = [
  "Dedicated to improving patient outcomes with compassionate care.",
  "Experienced specialist passionate about women's health.",
  "Committed to evidence-based medicine and patient advocacy.",
  "Focused on holistic approaches to long-term health.",
  "Known for excellent communication and patient trust.",
];

// Generate random availability
const generateAvailability = () => ({
  monday: rand(["9am - 4pm", "10am - 3pm", "OFF"]),
  tuesday: rand(["9am - 4pm", "OFF", "11am - 5pm"]),
  wednesday: rand(["OFF", "10am - 4pm", "9am - 2pm"]),
  thursday: rand(["9am - 3pm", "OFF", "12pm - 5pm"]),
  friday: rand(["8am - 2pm", "9am - 4pm", "OFF"]),
});

// Generate one doctor object
const generateDoctor = () => {
  const firstName = rand(firstNames);
  const lastName = rand(lastNames);
  const specialization = rand(specializations);

  return {
    firstName,
    lastName,
    email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${randInt(
      100,
      999
    )}@example.com`,
    passwordHash: bcrypt.hashSync("Password123!", 10),
    specialization,
    licenseNumber: `NG-${specialization.substring(0, 3).toUpperCase()}-${randInt(100, 999)}`,
    yearsOfExperience: randInt(3, 20),
    bio: rand(bios),
    profileImage: rand(profileImages),
    contactNumber: `+23480${randInt(10000000, 99999999)}`,
    availability: generateAvailability(),
    ratings: Number((Math.random() * (5 - 3) + 3).toFixed(1)),
    reviews: [],
    status: rand(["approved", "submitted", "reviewing"]),
  };
};

// Seeder
const seedDoctors = async () => {
  try {
    const count = Number(process.argv[2]) || 10; // default: 10 doctors

    await mongoose.connect(process.env.MONGODB_URI!);
    console.log("✅ Connected to MongoDB");

    await Doctor.deleteMany({});
    console.log("🗑️ Cleared existing doctors");

    const doctors = Array.from({ length: count }, () => generateDoctor());
    const created = await Doctor.insertMany(doctors);

    console.log(`✅ Successfully created ${created.length} doctors`);
    process.exit(0);
  } catch (error) {
    console.error("❌ Seed error:", error);
    process.exit(1);
  }
};

seedDoctors();
