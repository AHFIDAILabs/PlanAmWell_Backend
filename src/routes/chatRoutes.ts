// routes/chatRoutes.ts
import { Router } from "express";
import {
  getOrCreateConversation,
  sendMessage,
  getMessages,
  markAsRead,
  updateTyping,
  requestVideoCall,
  respondToVideoCall,
  cancelVideoCallRequest,
  getUserConversations,
  uploadChatMedia,
  uploadMiddleware
} from "../controllers/chatController";
import { verifyToken } from "../middleware/auth";

const chatRouter = Router();

// All routes require authentication
chatRouter.use(verifyToken);
chatRouter.post("/upload", uploadMiddleware, uploadChatMedia);

// Get user's conversations
chatRouter.get("/conversations", getUserConversations);

// Get or create conversation for appointment
chatRouter.get("/conversation/:appointmentId", getOrCreateConversation);

// Messages
chatRouter.post("/conversation/:conversationId/message", sendMessage);
chatRouter.get("/conversation/:conversationId/messages", getMessages);
chatRouter.post("/conversation/:conversationId/read", markAsRead);

// Typing indicator
chatRouter.post("/conversation/:conversationId/typing", updateTyping);

// Video call consent
chatRouter.post("/conversation/:conversationId/video-request", requestVideoCall);
chatRouter.post("/conversation/:conversationId/video-request/:requestId/respond", respondToVideoCall);
chatRouter.delete("/conversation/:conversationId/video-request/:requestId", cancelVideoCallRequest);

export default chatRouter;