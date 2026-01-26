// routes/cron.ts
import { Router } from "express";

const cronRouter = Router();

// Add a secret key in .env for security
// CRON_SECRET=supersecurestring
const CRON_SECRET = process.env.CRON_SECRET;

cronRouter.get("/ping", (req, res) => {
  const secret = req.query.secret;
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  return res.json({ message: "Backend alive!" });
});


export default cronRouter;
