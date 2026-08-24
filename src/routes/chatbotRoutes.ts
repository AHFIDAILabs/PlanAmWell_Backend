import express from 'express';
import rateLimit from 'express-rate-limit';
import {
  sendMessage,
  getConversationHistory,
  clearConversation,
  getUserConversations,
  transcribeAudio,
  uploadChatbotFile,
} from '../controllers/chatbotController';
import { guestAuth, verifyToken } from '../middleware/auth';
import { keyByUserOrIp } from '../middleware/rateLimit';

const chatBotRouter = express.Router();

// Each call here hits a paid external Groq API (chat completion or Whisper
// transcription) — tighter than the global default, and keyed by account
// (falls back to IP for guests) rather than just IP, placed after guestAuth
// so req.auth is already populated by the time this runs.
const chatbotLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUserOrIp,
  message: { success: false, message: "You're sending messages too quickly. Please slow down and try again shortly." },
});

const transcribeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUserOrIp,
  message: { success: false, message: "Too many voice messages. Please try again shortly." },
});

// Send message to chatbot - PUBLIC
chatBotRouter.post('/message', guestAuth, chatbotLimiter, sendMessage);

// Transcribe audio - PUBLIC
chatBotRouter.post('/transcribe', guestAuth, transcribeLimiter, transcribeAudio);

// Upload image or document from chatbot UI - PUBLIC
chatBotRouter.post('/upload', guestAuth, uploadChatbotFile);

// Get conversation history by sessionId - PUBLIC
chatBotRouter.get('/conversation/:sessionId', guestAuth, getConversationHistory);

// Clear conversation by sessionId - PUBLIC
chatBotRouter.delete('/conversation/:sessionId', guestAuth, clearConversation);

// Get all user conversations - PROTECTED
chatBotRouter.get('/conversations/:userId', guestAuth, verifyToken, getUserConversations);

export default chatBotRouter;
