// scripts/fixCartStatus.ts
import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";

async function fixCartStatus() {
  try {
    await mongoose.connect(process.env.MONGODB_URI as string);
    console.log("✅ Connected to MongoDB");

    // Reset all checked_out carts back to active
    const result = await mongoose.connection.collection("carts").updateMany(
      { status: "checked_out" },
      { $set: { status: "active" } }
    );

    console.log(`✅ Reset ${result.modifiedCount} checked_out carts to active`);

    // Also fix any with no status
    const result2 = await mongoose.connection.collection("carts").updateMany(
      { status: { $exists: false } },
      { $set: { status: "active" } }
    );

    console.log(`✅ Fixed ${result2.modifiedCount} carts with no status`);

  } catch (err) {
    console.error("❌ Error:", err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

fixCartStatus();