// backend/script/seedDoctorReviews.ts
import mongoose from "mongoose";
import dotenv from "dotenv";
import { Doctor } from "../models/doctor";
import { Review } from "../models/reviews"; // create a Review model if you don't have one
import faker from "faker";

dotenv.config();

const seedReviews = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI!);
    console.log("✅ Connected");

    const doctors = await Doctor.find({}).lean();
    if (!doctors.length) {
      console.log("No doctors found to seed reviews for.");
      process.exit(0);
    }

    // Remove old reviews (optional)
    await Review.deleteMany({});
    const reviewsToInsert: any[] = [];

    doctors.forEach((d) => {
      const count = Math.floor(Math.random() * 6) + 1; // 1-6 reviews
      for (let i = 0; i < count; i++) {
        reviewsToInsert.push({
          doctorId: d._id,
          userName: faker.name.findName(),
          rating: Math.floor(Math.random() * 2) + 4, // 4 or 5
          comment: faker.lorem.sentences(2),
          createdAt: faker.date.recent(90),
        });
      }
    });

    const created = await Review.insertMany(reviewsToInsert);
    console.log(`✅ Created ${created.length} reviews`);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

seedReviews();
