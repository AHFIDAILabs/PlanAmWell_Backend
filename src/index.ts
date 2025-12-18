// index.ts - Updated Socket.IO configuration for React Native
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import http from "http";
import mongoose from "mongoose";
import { errorHandler } from "./middleware/errorHandler";
import "./cron/reminderJob";
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
import whatsappRouter from "./routes/metaWhatsapp";
import advocacyRouter from "./routes/advocacyRoutes";
import commentRouter from "./routes/commentRoutes";
import adminRouter from "./routes/adminRoutes";
import appointmentRouter from "./routes/appointmentRoutes";
import videoRouter from "./routes/videoRoutes";

import { Server } from "socket.io";
import { verifyJwtToken } from "./middleware/auth";

const app = express();
const server = http.createServer(app);

// backend/index.ts - Verify this section
export const io = new Server(server, {
  cors: {
    origin: "*", // ✅ Good for development
    methods: ["GET", "POST"],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  },
  transports: ['websocket', 'polling'], // ✅ Both transports
  allowEIO3: true, // ✅ Support older clients
  pingTimeout: 60000,
  pingInterval: 25000,
  connectTimeout: 45000,
  serveClient: false, // Don't serve client files
  cookie: false, // Disable cookies for mobile
});

// ✅ Track connected users
const connectedUsers = new Map<string, string>(); // userId -> socketId

// ✅ Socket.IO Authentication Middleware
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  
  if (!token) {
    console.log("❌ Socket connection rejected: No token");
    console.log("Handshake data:", socket.handshake);
    return next(new Error("Authentication error: No token provided"));
  }

  try {
    const user = verifyJwtToken(token);
    
    if (!user || !user.id) {
      console.log("❌ Socket connection rejected: Invalid token");
      return next(new Error("Authentication error: Invalid token"));
    }

    socket.data.user = user;
    console.log(`✅ Socket authenticated for user ${user.id}`);
    next();
  } catch (err: any) {
    console.error("❌ Socket auth error:", err.message);
    return next(new Error("Authentication error: Token verification failed"));
  }
});

// ✅ Connection Handler
io.on("connection", (socket) => {
  const user = socket.data.user;
  
  if (!user || !user.id) {
    console.log("❌ No user data, disconnecting socket");
    return socket.disconnect();
  }

  const userId = user.id.toString();
  const roomName = `user_${userId}`;

  // Join user-specific room
  socket.join(roomName);
  connectedUsers.set(userId, socket.id);

  console.log(`🔌 User ${userId} connected (socket: ${socket.id})`);
  console.log(`📍 Active connections: ${connectedUsers.size}`);
  console.log(`🔌 Transport: ${socket.conn.transport.name}`);

  // ✅ Emit connection success to client
  socket.emit("connected", {
    userId,
    socketId: socket.id,
    message: "Successfully connected to notification server",
    timestamp: new Date().toISOString(),
  });

  // ✅ Handle manual notification read from client
  socket.on("mark-notification-read", async (notificationId: string) => {
    try {
      console.log(`✅ User ${userId} marked notification ${notificationId} as read`);
      // Add DB update here if needed
    } catch (error) {
      console.error("Error marking notification as read:", error);
    }
  });

  // ✅ Handle ping from client
  socket.on("ping", () => {
    socket.emit("pong", { timestamp: Date.now() });
  });

  // ✅ Handle disconnect
  socket.on("disconnect", (reason) => {
    connectedUsers.delete(userId);
    console.log(`🔌 User ${userId} disconnected. Reason: ${reason}`);
    console.log(`📍 Active connections: ${connectedUsers.size}`);
  });

  // ✅ Handle errors
  socket.on("error", (error) => {
    console.error(`❌ Socket error for user ${userId}:`, error);
  });
});

// ✅ Enhanced Notification Emitter with validation
export const emitNotification = (userId: string, notification: any) => {
  try {
    const roomName = `user_${userId}`;
    const userSocketId = connectedUsers.get(userId);

    if (userSocketId) {
      io.to(roomName).emit("new-notification", notification);
      console.log(`🔔 Real-time notification sent to user ${userId} (socket: ${userSocketId})`);
      return true;
    } else {
      console.log(`⚠️ User ${userId} not connected, notification queued for next login`);
      return false;
    }
  } catch (error) {
    console.error(`❌ Failed to emit notification to user ${userId}:`, error);
    return false;
  }
};

// ✅ Helper to check if user is online
export const isUserOnline = (userId: string): boolean => {
  return connectedUsers.has(userId);
};

// ✅ Get all connected users (for admin dashboard)
export const getConnectedUsers = () => {
  return Array.from(connectedUsers.keys());
};

// Middleware - Enhanced CORS for mobile
app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],}));

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
}));

// Increase limits BEFORE your routes
app.use(express.json({ limit: '25mb' })); 
app.use(express.urlencoded({ limit: '25mb', extended: true }));

app.use(morgan("dev"));

// Health check
app.get("/", (req, res) => {
  res.status(200).json({
    status: "Server is healthy",
    message: "AmWell Backend is operational.",
    version: "1.0.0",
    activeConnections: connectedUsers.size,
    connectedUsers: Array.from(connectedUsers.keys()).length,
    timestamp: new Date().toISOString(),
  });
});

// Socket.IO status endpoint (for debugging)
app.get("/api/v1/socket/status", (req, res) => {
  res.json({
    activeConnections: connectedUsers.size,
    connectedUserIds: Array.from(connectedUsers.keys()),
    timestamp: new Date().toISOString(),
  });
});

// Routes
app.use("/api/v1/admin", adminRouter);
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
app.use("/api/v1/whatsapp", whatsappRouter);
app.use("/api/v1/advocacy", advocacyRouter);
app.use("/api/v1/comment", commentRouter);
app.use("/api/v1/appointments", appointmentRouter);
app.use("/api/v1/video", videoRouter);

app.use(errorHandler);

const PORT: number = Number(process.env.PORT) || 4000;

mongoose
  .connect(process.env.MONGODB_URI as string)
  .then(() => {
    console.log("✅ MongoDB Connected");
    server.listen(PORT, '0.0.0.0', () => { // ⭐ Listen on all interfaces
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🔌 Socket.IO server ready`);
      console.log(`📱 WebSocket endpoint: ws://YOUR_IP:${PORT}`);
      console.log(`🌐 HTTP endpoint: http://YOUR_IP:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ MongoDB Connection Error:", err);
    process.exit(1);
  });

process.on("unhandledRejection", (err: any) => {
  console.error("❌ Unhandled Rejection:", err.message);
  server.close(() => process.exit(1));
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("👋 SIGTERM received, closing server gracefully");
  server.close(() => {
    console.log("✅ Server closed");
    mongoose.connection.close(false);
    process.exit(0);
  });
});