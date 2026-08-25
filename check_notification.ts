import "dotenv/config";
import mongoose from "mongoose";
import Notification from "./src/models/notifications";

async function main() {
  await mongoose.connect(process.env.MONGODB_URI!);
  const notifs = await Notification.find({
    userId: "692dbbe722e079cf2a3a7b09",
    createdAt: { $gte: new Date(Date.now() - 10 * 60 * 1000) },
  }).sort({ createdAt: -1 }).limit(3);
  console.log("Recent notifications for doctor Funke Chukwu:", JSON.stringify(notifs, null, 2));
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
