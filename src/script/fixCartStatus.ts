// scripts/fixCartStatus.ts
import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";

async function fixCartStatus() {
  try {
    await mongoose.connect(process.env.MONGODB_URI as string);
    console.log("✅ Connected to MongoDB");

    const result = await mongoose.connection.collection("carts").updateMany(
      { status: { $exists: false } },
      { $set: { status: "active" } }
    );

    console.log(`✅ Updated ${result.modifiedCount} carts`);
  } catch (err) {
    console.error("❌ Error:", err);
  } finally {
    await mongoose.disconnect();
    console.log("✅ Disconnected");
    process.exit(0);
  }
}

fixCartStatus();