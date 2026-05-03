// backend/script/seedHospitals.ts
// Run: npx ts-node src/script/seedHospitals.ts

import mongoose from "mongoose";
import dotenv from "dotenv";
import { Hospital } from "../models/hospital";

dotenv.config();

const sampleHospitals = [
  {
    name: "St. Mary's Women & Family Clinic",
    slug: "st-marys-women-clinic",
    type: "private",
    address: "12 Ajose Street, Victoria Island",
    city: "Lagos",
    state: "Lagos",
    lga: "Eti-Osa",
    phone: "+2347011110001",
    email: "info@stmarysclinic.ng",
    website: "https://stmarysclinic.example.com",
    image: "https://images.unsplash.com/photo-1586773860418-d8d21b6e3bfbf?w=800&q=80",
    specialties: ["OB/GYN", "Fertility", "Antenatal Care", "Postnatal Care"],
    services: ["Ultrasound", "Labour & Delivery", "Family Planning", "Cervical Cancer Screening"],
    openingHours: "Mon – Sat: 7am – 8pm, Sun: 9am – 4pm",
    isActive: true,
    rating: 4.7,
    totalRatings: 132,
  },
  {
    name: "Hope Fertility Center",
    slug: "hope-fertility-center",
    type: "private",
    address: "45 Hospital Road, Wuse II",
    city: "Abuja",
    state: "FCT",
    lga: "Abuja Municipal",
    phone: "+2347011110002",
    email: "care@hopefertility.ng",
    website: "https://hopefertility.example.com",
    image: "https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?w=800&q=80",
    specialties: ["Fertility", "Reproductive Medicine", "IVF", "Hormonal Therapy"],
    services: ["IVF/ICSI", "Egg Freezing", "Semen Analysis", "Sperm Banking", "Ovulation Induction"],
    openingHours: "Mon – Fri: 8am – 6pm, Sat: 9am – 2pm",
    isActive: true,
    rating: 4.9,
    totalRatings: 87,
  },
  {
    name: "Garki General Hospital",
    slug: "garki-general-hospital",
    type: "public",
    address: "Hospital Road, Area 3, Garki",
    city: "Abuja",
    state: "FCT",
    lga: "Abuja Municipal",
    phone: "+2349031234567",
    email: "admin@garkihosp.gov.ng",
    image: "https://images.unsplash.com/photo-1538108149393-fbbd81895907?w=800&q=80",
    specialties: ["General Medicine", "Surgery", "Paediatrics", "Obstetrics"],
    services: ["Emergency Care", "Outpatient Clinic", "Laboratory", "Radiology", "Pharmacy"],
    openingHours: "24 Hours, 7 Days a Week",
    isActive: true,
    rating: 3.8,
    totalRatings: 210,
  },
  {
    name: "Lagoon Hospital",
    slug: "lagoon-hospital-ikeja",
    type: "private",
    address: "27 Mobolaji Bank-Anthony Way, Ikeja",
    city: "Ikeja",
    state: "Lagos",
    lga: "Ikeja",
    phone: "+2341-2701000",
    email: "enquiries@lagoonhospital.com",
    website: "https://lagoonhospital.com",
    image: "https://images.unsplash.com/photo-1587351021759-3e566b6af7cc?w=800&q=80",
    specialties: ["Cardiology", "Neurology", "Oncology", "Orthopaedics", "Urology"],
    services: ["ICU", "MRI", "CT Scan", "Chemotherapy", "Dialysis", "Physiotherapy"],
    openingHours: "24 Hours, 7 Days a Week",
    isActive: true,
    rating: 4.6,
    totalRatings: 304,
  },
  {
    name: "SOGHAS Women's Health Clinic",
    slug: "soghas-womens-health",
    type: "NGO",
    address: "7 Adeola Hopewell Street, VI",
    city: "Lagos",
    state: "Lagos",
    lga: "Eti-Osa",
    phone: "+2348012345678",
    email: "hello@soghas.org",
    website: "https://soghas.org",
    image: "https://images.unsplash.com/photo-1579684385127-1ef15d508118?w=800&q=80",
    specialties: ["Sexual & Reproductive Health", "STI Management", "Contraception"],
    services: ["Free Cervical Screening", "STI Testing", "Contraceptive Counselling", "Mental Health Support"],
    openingHours: "Mon – Fri: 9am – 5pm",
    isActive: true,
    rating: 4.5,
    totalRatings: 58,
  },
  {
    name: "New Life Fertility Clinic",
    slug: "new-life-fertility-clinic",
    type: "private",
    address: "15 Awolowo Road, Ikoyi",
    city: "Lagos",
    state: "Lagos",
    lga: "Eti-Osa",
    phone: "+2348098765432",
    email: "info@newlifefertility.ng",
    image: "https://images.unsplash.com/photo-1551601651-2a8555f1a136?w=800&q=80",
    specialties: ["Fertility", "Reproductive Endocrinology", "Gynaecology"],
    services: ["IVF", "Intrauterine Insemination", "Fertility Preservation", "Preimplantation Genetic Testing"],
    openingHours: "Mon – Sat: 8am – 7pm",
    isActive: true,
    rating: 4.8,
    totalRatings: 63,
  },
  {
    name: "UCH — University College Hospital",
    slug: "uch-ibadan",
    type: "public",
    address: "Queen Elizabeth Road, Ibadan",
    city: "Ibadan",
    state: "Oyo",
    lga: "Ibadan North",
    phone: "+2348033451670",
    email: "info@uch.com.ng",
    website: "https://uch.com.ng",
    image: "https://images.unsplash.com/photo-1626315869436-d6781ba69d6e?w=800&q=80",
    specialties: ["All Medical Specialties", "Teaching Hospital", "Research", "Oncology", "Transplant"],
    services: ["Tertiary Care", "Clinical Trials", "Residency Training", "All Outpatient Services"],
    openingHours: "24 Hours, 7 Days a Week",
    isActive: true,
    rating: 4.3,
    totalRatings: 519,
  },
  {
    name: "Sunrise Women's Wellness Centre",
    slug: "sunrise-womens-wellness",
    type: "private",
    address: "22 Trans-Amadi Road",
    city: "Port Harcourt",
    state: "Rivers",
    lga: "Obio-Akpor",
    phone: "+2348155500001",
    email: "hello@sunrisewellness.ng",
    image: "https://images.unsplash.com/photo-1559757175-5700dde675bc?w=800&q=80",
    specialties: ["OB/GYN", "Menopause Care", "Adolescent Health", "Breast Health"],
    services: ["Mammography", "Pap Smear", "Antenatal Care", "Menopause Clinic", "Well-Woman Screening"],
    openingHours: "Mon – Fri: 8am – 6pm, Sat: 9am – 3pm",
    isActive: true,
    rating: 4.4,
    totalRatings: 75,
  },
];

const seedHospitals = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI!);
    console.log("✅ Connected to MongoDB");

    await Hospital.deleteMany({});
    console.log("🗑️  Cleared existing hospitals");

    const created = await Hospital.insertMany(sampleHospitals);
    console.log(`✅ Seeded ${created.length} clinics successfully`);

    process.exit(0);
  } catch (err) {
    console.error("❌ Seeder error:", err);
    process.exit(1);
  }
};

seedHospitals();
