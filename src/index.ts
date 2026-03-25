// index.ts - FIXED Socket.IO with Appointment Rooms

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

// Import routers
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
import partnerRouter from "./routes/partnerRoutes";
import cronRouter from "./routes/cron";
import chatRouter from "./routes/chatRoutes";

import { Server } from "socket.io";
import { verifyJwtToken } from "./middleware/auth";

const app = express();
const server = http.createServer(app);

export const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  },
  transports: ["websocket", "polling"],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
  connectTimeout: 45000,
  serveClient: false,
  cookie: false,
});

// ✅ Track connected users (for notifications)
const connectedUsers = new Map<string, string>(); // userId -> socketId

// ✅ Track appointment room memberships
const appointmentRooms = new Map<string, Set<string>>(); // appointmentId -> Set of userIds

// ✅ Socket.IO Authentication Middleware
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;

  if (!token) {
    console.log("❌ Socket connection rejected: No token");
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
  const userRoomName = `user_${userId}`;

  // Join user-specific room (for notifications)
  socket.join(userRoomName);
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

  // ✅ Join appointment room
  socket.on("join-appointment", ({ appointmentId }: { appointmentId: string }) => {
    const roomName = `appointment:${appointmentId}`;
    socket.join(roomName);

    // Track membership
    if (!appointmentRooms.has(appointmentId)) {
      appointmentRooms.set(appointmentId, new Set());
    }
    appointmentRooms.get(appointmentId)!.add(userId);

    console.log(`📡 User ${userId} joined appointment room: ${roomName}`);
    console.log(`👥 Room ${appointmentId} has ${appointmentRooms.get(appointmentId)!.size} members`);
  });

  // ✅ Leave appointment room
  socket.on("leave-appointment", ({ appointmentId }: { appointmentId: string }) => {
    const roomName = `appointment:${appointmentId}`;
    socket.leave(roomName);

    // Remove from tracking
    if (appointmentRooms.has(appointmentId)) {
      appointmentRooms.get(appointmentId)!.delete(userId);
      if (appointmentRooms.get(appointmentId)!.size === 0) {
        appointmentRooms.delete(appointmentId);
      }
    }

    console.log(`📡 User ${userId} left appointment room: ${roomName}`);
  });

  // ✅ Handle manual notification read from client
  socket.on("mark-notification-read", async (notificationId: string) => {
    try {
      console.log(`✅ User ${userId} marked notification ${notificationId} as read`);
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

    // Remove user from all appointment rooms
    appointmentRooms.forEach((members, appointmentId) => {
      members.delete(userId);
      if (members.size === 0) {
        appointmentRooms.delete(appointmentId);
      }
    });

    console.log(`🔌 User ${userId} disconnected. Reason: ${reason}`);
    console.log(`📍 Active connections: ${connectedUsers.size}`);
  });

  // ✅ Handle errors
  socket.on("error", (error) => {
    console.error(`❌ Socket error for user ${userId}:`, error);
  });
});

// ✅ Emit notification to user (for push notifications)
export const emitNotification = (userId: string, notification: any) => {
  try {
    const roomName = `user_${userId}`;
    const userSocketId = connectedUsers.get(userId);

    if (userSocketId) {
      io.to(roomName).emit("notification", notification);
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

// ✅ Emit rejoin call alert to specific user
export const emitRejoinCallAlert = (
  userId: string,
  appointmentId: string,
  userName: string
) => {
  try {
    const roomName = `user_${userId}`;
    const userSocketId = connectedUsers.get(userId);

    if (userSocketId) {
      io.to(roomName).emit("patient-rejoin-call", {
        appointmentId,
        userName,
        message: `${userName} is in the call and waiting for you.`,
        timestamp: new Date().toISOString(),
      });
      console.log(`📞 Rejoin call alert sent to user ${userId}`);
      return true;
    } else {
      console.log(`⚠️ User ${userId} not online`);
      return false;
    }
  } catch (error) {
    console.error(`❌ Failed to emit rejoin alert:`, error);
    return false;
  }
};

// ✅ FIXED: Emit call ended to APPOINTMENT ROOM (not individual users)
export const emitCallEnded = (
  userId: string,
  appointmentId: string,
  callDuration?: number
) => {
  try {
    const roomName = `appointment:${appointmentId}`;

    // Emit to appointment room (both doctor and patient will receive it)
    io.to(roomName).emit("call-ended", {
      appointmentId,
      callDuration,
      timestamp: new Date().toISOString(),
    });

    const membersCount = appointmentRooms.get(appointmentId)?.size || 0;
    console.log(`📞 Call ended notification sent to appointment room ${appointmentId} (${membersCount} members)`);

    return true;
  } catch (error) {
    console.error(`❌ Failed to emit call ended:`, error);
    return false;
  }
};

// ✅ NEW: Emit call started to appointment room
export const emitCallStarted = (appointmentId: string, startedBy: string) => {
  try {
    const roomName = `appointment:${appointmentId}`;

    io.to(roomName).emit("call-started", {
      appointmentId,
      startedBy,
      timestamp: new Date().toISOString(),
    });

    console.log(`📞 Call started notification sent to appointment room ${appointmentId}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to emit call started:`, error);
    return false;
  }
};

// ✅ NEW: Emit call ringing to appointment room
export const emitCallRinging = (appointmentId: string, initiatedBy: string) => {
  try {
    const roomName = `appointment:${appointmentId}`;

    io.to(roomName).emit("call-ringing", {
      appointmentId,
      initiatedBy,
      timestamp: new Date().toISOString(),
    });

    console.log(`📞 Call ringing notification sent to appointment room ${appointmentId}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to emit call ringing:`, error);
    return false;
  }
};

// ✅ NEW: Emit appointment updated to appointment room
export const emitAppointmentUpdated = (appointmentId: string, appointment: any) => {
  try {
    const roomName = `appointment:${appointmentId}`;

    io.to(roomName).emit("appointment-updated", {
      appointment,
      timestamp: new Date().toISOString(),
    });

    console.log(`📞 Appointment updated notification sent to room ${appointmentId}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to emit appointment updated:`, error);
    return false;
  }
};

export const emitNewMessage = (
  conversationId: string,
  message: any,
  recipientId: string
) => {
  try {
    const roomName = `user_${recipientId}`;
    
    io.to(roomName).emit("new-message", {
      conversationId,
      message,
      timestamp: new Date().toISOString(),
    });
    
    console.log(`💬 New message sent to user ${recipientId}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to emit new message:`, error);
    return false;
  }
};

// ✅ NEW: Emit typing indicator
export const emitTypingIndicator = (
  conversationId: string,
  recipientId: string,
  isTyping: boolean,
  senderRole: string
) => {
  try {
    const roomName = `user_${recipientId}`;
    
    io.to(roomName).emit("typing-indicator", {
      conversationId,
      isTyping,
      senderRole,
      timestamp: new Date().toISOString(),
    });
    
    return true;
  } catch (error) {
    console.error(`❌ Failed to emit typing indicator:`, error);
    return false;
  }
};

// ✅ NEW: Emit message read receipt
export const emitMessageRead = (
  conversationId: string,
  recipientId: string
) => {
  try {
    const roomName = `user_${recipientId}`;
    
    io.to(roomName).emit("messages-read", {
      conversationId,
      timestamp: new Date().toISOString(),
    });
    
    return true;
  } catch (error) {
    console.error(`❌ Failed to emit message read:`, error);
    return false;
  }
};

// ✅ NEW: Emit video call request
export const emitVideoCallRequest = (
  conversationId: string,
  recipientId: string,
  requesterName: string,
  requestId: string
) => {
  try {
    const roomName = `user_${recipientId}`;
    
    io.to(roomName).emit("video-call-request", {
      conversationId,
      requesterName,
      requestId,
      timestamp: new Date().toISOString(),
    });
    
    console.log(`📞 Video call request sent to user ${recipientId}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to emit video call request:`, error);
    return false;
  }
};

// ✅ NEW: Emit video call response
export const emitVideoCallResponse = (
  conversationId: string,
  requesterId: string,
  status: "accepted" | "declined" | "expired" | "cancelled",
  requestId: string
) => {
  try {
    const roomName = `user_${requesterId}`;
    
    io.to(roomName).emit("video-call-response", {
      conversationId,
      status,
      requestId,
      timestamp: new Date().toISOString(),
    });
    
    console.log(`📞 Video call response (${status}) sent to user ${requesterId}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to emit video call response:`, error);
    return false;
  }
};


/**
 * Emit appointment-ended to the appointment room.
 * Both doctor and patient receive this and lock their UI.
 */
export const emitAppointmentEnded = (appointmentId: string) => {
  try {
    const roomName = `appointment:${appointmentId}`;
    io.to(roomName).emit("appointment-ended", {
      appointmentId,
      timestamp: new Date().toISOString(),
    });
    console.log(`🏁 appointment-ended emitted to room ${appointmentId}`);
    return true;
  } catch (error) {
    console.error("❌ Failed to emit appointment-ended:", error);
    return false;
  }
};

// ✅ Helper to check if user is online
export const isUserOnline = (userId: string): boolean => {
  return connectedUsers.has(userId);
};

// ✅ Get all connected users
export const getConnectedUsers = () => {
  return Array.from(connectedUsers.keys());
};

// ✅ Get user's socket ID
export const getUserSocketId = (userId: string): string | undefined => {
  return connectedUsers.get(userId);
};

// ✅ Get appointment room members
export const getAppointmentRoomMembers = (appointmentId: string): string[] => {
  return Array.from(appointmentRooms.get(appointmentId) || []);
};


// Middleware
app.use(
  cors({
    origin: "*",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  })
);

app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ limit: "25mb", extended: true }));
app.use(morgan("dev"));

// Health check
app.get("/", (req, res) => {
  res.status(200).json({
    status: "Server is healthy",
    message: "AskAmWell Backend is operational.",
    version: "1.0.0",
    activeConnections: connectedUsers.size,
    appointmentRooms: appointmentRooms.size,
    timestamp: new Date().toISOString(),
  });
});

// Socket.IO status endpoint
app.get("/api/v1/socket/status", (req, res) => {
  res.json({
    activeConnections: connectedUsers.size,
    connectedUserIds: Array.from(connectedUsers.keys()),
    appointmentRooms: Array.from(appointmentRooms.keys()).map((id) => ({
      appointmentId: id,
      members: getAppointmentRoomMembers(id),
    })),
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
app.use("/api/v1/partners", partnerRouter);
app.use("/api/v1/cron", cronRouter);
app.use("/api/v1/chat", chatRouter);

app.use(errorHandler);

const PORT: number = Number(process.env.PORT) || 4000;

mongoose
  .connect(process.env.MONGODB_URI as string)
  .then(() => {
    console.log("✅ MongoDB Connected");
    server.listen(PORT, "0.0.0.0", () => {
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

process.on("SIGTERM", () => {
  console.log("👋 SIGTERM received, closing server gracefully");
  server.close(() => {
    console.log("✅ Server closed");
    mongoose.connection.close(false);
    process.exit(0);
  });
});