// backend/src/cron/pingBackend.ts
import dotenv from "dotenv";
dotenv.config();

const CRON_SECRET = process.env.CRON_SECRET;
const BACKEND_URL = "https://your-app.onrender.com/api/v1/cron/ping";

setInterval(async () => {
  try {
    await fetch(BACKEND_URL, {
      method: "GET",
      headers: { "x-cron-secret": CRON_SECRET },
    });
    console.log("✅ Pinged backend successfully");
  } catch (err) {
    console.error("❌ Ping failed:", err);
  }
}, 30 * 1000); // every 30 seconds
