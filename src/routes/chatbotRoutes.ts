import express from 'express';
import { 
    sendMessage, 
    getConversationHistory,
    clearConversation,
    getUserConversations
} from '../controllers/chatbotController';
import { guestAuth, verifyToken } from '../middleware/auth'; // Your auth middleware

const chatBotRouter = express.Router();

// Send message to chatbot - PUBLIC (no auth required)
chatBotRouter.post('/message', guestAuth, sendMessage);

// Get conversation history by sessionId - PUBLIC
chatBotRouter.get('/conversation/:sessionId', guestAuth, getConversationHistory);

// Clear conversation by sessionId - PUBLIC
chatBotRouter.delete('/conversation/:sessionId', guestAuth, clearConversation);

// Get all user conversations - PROTECTED (requires auth)
chatBotRouter.get('/conversations/:userId', guestAuth, verifyToken, getUserConversations);

export default chatBotRouter;