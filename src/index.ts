// src/index.ts

// MUST BE FIRST - Load environment variables before any other imports
import dotenv from "dotenv";
dotenv.config();

// Now import everything else
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import http from "http";
import mongoose from "mongoose";
import { errorHandler } from "./middleware/errorHandler";
import categoryRouter from "./routes/categoryRoutes";
import productRouter from "./routes/productRoutes";
import doctorRouter from "./routes/doctorRoutes";
import orderRouter from "./routes/orderRoutes";
import authRouter from "./routes/authRoutes";
import userRouter from "./routes/userRoutes";
import checkoutRouter from "./routes/checkoutRoutes";
import cartRouter from "./routes/cartRoutes";
import paymentRouter from "./routes/paymentRoutes";
import notificationRouter from "./routes/notificationRoutes";
import chatBotRouter from "./routes/chatbotRoutes";
import whatsappRouter from "./routes/metaWhatsapp"

// Initialize Express app
const app = express();

// === Create HTTP Server ===
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(helmet());
app.use(express.json());
app.use(morgan("dev"));

// Routes
app.use("/api/v1/notifications", notificationRouter);
app.use("/api/v1/categories", categoryRouter);
app.use("/api/v1/products", productRouter);
app.use("/api/v1/doctors", doctorRouter);
app.use("/api/v1/orders", orderRouter);
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/users", userRouter);
app.use("/api/v1/chatbot", chatBotRouter);
app.use("/api/v1/checkout", checkoutRouter);
app.use("/api/v1/cart", cartRouter);
app.use("/api/v1/payment", paymentRouter);
app.use("/api/v1/whatsapp", whatsappRouter)


// Error Handling Middleware
app.use(errorHandler);

// Connect to MongoDB and start server
const PORT: number = Number(process.env.PORT) || 4000;

mongoose
  .connect(process.env.MONGODB_URI as string)
  .then(() => {
    console.log("✅ MongoDB Connected");
    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ MongoDB Connection Error:", err);
    process.exit(1);
  });

// === Handle Unhandled Promise Rejections ===
process.on("unhandledRejection", (err: any) => {
  console.error("❌ Unhandled Rejection:", err.message);
  server.close(() => process.exit(1));
});