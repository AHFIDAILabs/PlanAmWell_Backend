import express from 'express';
import { 
  sendMessage, 
  getConversationHistory,
  clearConversation,
  getUserConversations,
  transcribeAudio
} from '../controllers/chatbotController';
import { guestAuth, verifyToken } from '../middleware/auth';

const chatBotRouter = express.Router();

// Send message to chatbot - PUBLIC
chatBotRouter.post('/message', guestAuth, sendMessage);

// Transcribe audio - PUBLIC
chatBotRouter.post('/transcribe', guestAuth, transcribeAudio);

// Get conversation history by sessionId - PUBLIC
chatBotRouter.get('/conversation/:sessionId', guestAuth, getConversationHistory);

// Clear conversation by sessionId - PUBLIC
chatBotRouter.delete('/conversation/:sessionId', guestAuth, clearConversation);

// Get all user conversations - PROTECTED
chatBotRouter.get('/conversations/:userId', guestAuth, verifyToken, getUserConversations);

export default chatBotRouter;
