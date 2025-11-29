import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { Product, IProduct } from '../models/product';
import { ChatConversation, IMessage } from '../models/ChatConversation';
import { Intent, ChatbotRequest, ChatbotResponse } from '../types/chatbot.types';

// Helper function to detect user intent
const detectIntent = (message: string): Intent => {
    const lowerMessage = message.toLowerCase();
    
    // Buy intent
    const buyKeywords = ['buy', 'order', 'purchase', 'get', 'need', 'want', 'looking for', 'shop', 'add to cart'];
    if (buyKeywords.some(keyword => lowerMessage.includes(keyword))) {
        return 'buy';
    }
    
    // Info/question intent
    const infoKeywords = ['what is', 'how', 'why', 'tell me', 'explain', 'information', 'about'];
    if (infoKeywords.some(keyword => lowerMessage.includes(keyword))) {
        return 'info';
    }
    
    // Appointment intent
    const appointmentKeywords = ['appointment', 'book', 'schedule', 'doctor', 'consultation', 'see a doctor'];
    if (appointmentKeywords.some(keyword => lowerMessage.includes(keyword))) {
        return 'appointment';
    }
    
    // Greeting
    const greetingKeywords = ['hi', 'hello', 'hey', 'good morning', 'good afternoon', 'good evening'];
    if (greetingKeywords.some(keyword => lowerMessage.includes(keyword))) {
        return 'greeting';
    }
    
    return 'general';
};

// Helper function to extract product keywords from message
// ✅ ULTRA-CLEAN: Extract only the product name
const extractProductKeywords = (message: string): string => {
    let cleaned = message.toLowerCase().trim();
    
    // Step 1: Remove leading intent phrases (most important!)
    const leadingPhrases = [
        'i would like to',
        'would like to',
        'i want to',
        'want to',
        'i need to',
        'need to',
        'looking for',
        'search for',
        'find me',
        'show me',
        'give me',
        'get me',
        'i need',
        'need',
        'buy',
        'order',
        'purchase',
        'get',
        'find'
    ];
    
    for (const phrase of leadingPhrases) {
        if (cleaned.startsWith(phrase)) {
            cleaned = cleaned.substring(phrase.length).trim();
            break;
        }
    }
    
    // Step 2: Remove trailing politeness
    const trailingPhrases = ['please', 'plz', 'pls', 'thanks', 'thank you'];
    for (const phrase of trailingPhrases) {
        if (cleaned.endsWith(phrase)) {
            cleaned = cleaned.substring(0, cleaned.length - phrase.length).trim();
        }
    }
    
    // Step 3: Remove articles at the beginning
    const articles = ['a ', 'an ', 'the ', 'some '];
    for (const article of articles) {
        if (cleaned.startsWith(article)) {
            cleaned = cleaned.substring(article.length);
            break;
        }
    }
    
    // Step 4: Final cleanup
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    
    console.log(`📝 "${message}" → "${cleaned}"`);
    
    return cleaned;
};

// ✅ IMPROVED: Search products with better matching
const searchProducts = async (query: string, limit: number = 5): Promise<any[]> => {
    try {
        if (!query || query.trim() === '') {
            console.log('⚠️ Empty search query');
            return [];
        }

        // Clean and tokenize the query
        const cleanedQuery = query
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ') // Replace special chars with space
            .replace(/\s+/g, ' ')
            .trim();
        
        // Split into individual search terms (words longer than 2 chars)
        const searchTerms = cleanedQuery.split(' ').filter(term => term.length > 2);
        
        console.log(`🔍 Searching for: "${cleanedQuery}"`);
        console.log(`📋 Search terms: [${searchTerms.join(', ')}]`);
        
        if (searchTerms.length === 0) {
            console.log('⚠️ No valid search terms after cleaning');
            return [];
        }

        // Build flexible search query
        const orConditions = [];
        
        // Search for each individual term
        for (const term of searchTerms) {
            orConditions.push(
                { name: { $regex: term, $options: 'i' } },
                { categoryName: { $regex: term, $options: 'i' } },
                { manufacturerName: { $regex: term, $options: 'i' } },
                { sku: { $regex: term, $options: 'i' } }
            );
        }
        
        // Also try the full cleaned query as a phrase
        if (cleanedQuery !== searchTerms[0]) {
            orConditions.push(
                { name: { $regex: cleanedQuery, $options: 'i' } },
                { categoryName: { $regex: cleanedQuery, $options: 'i' } },
                { manufacturerName: { $regex: cleanedQuery, $options: 'i' } }
            );
        }

        // Execute search
        const products = await Product.find({
            $and: [
                { $or: orConditions },
                { stockQuantity: { $gt: 0 } },
                { status: { $ne: 'inactive' } }
            ]
        })
        .limit(limit)
        .lean();
        
        console.log(`✅ Found ${products.length} products`);
        if (products.length > 0) {
            console.log(`📦 Products: ${products.map(p => p.name).join(', ')}`);
        }
        
        return products;
    } catch (error) {
        console.error('❌ Error searching products:', error);
        return [];
    }
};

// Generate bot response based on intent
const generateBotResponse = (intent: Intent, products: any[], userMessage: string): string => {
    switch (intent) {
        case 'greeting':
            return "Hello! I'm Ask AmWell, your confidential health assistant. I can help you find services, products, and doctors - and you can book or order directly through our chat!";
        case 'buy':
            if (products.length > 0) {
                const productNames = products.slice(0, 3).map(p => p.name).join(', ');
                return `Great! I found ${products.length} product${products.length > 1 ? 's' : ''} for you${products.length > 3 ? ' (showing top 3)' : ''}: ${productNames}. You can add them to your cart below! 🛒`;
            } else {
                const query = extractProductKeywords(userMessage);
                if (!query) {
                    return `I'd be happy to help you find products! 🔍\n\nPlease tell me what you're looking for. You can search by:\n• Product name (e.g., "Paracetamol", "Amoxicillin")\n• Category (e.g., "pain relief", "antibiotics")\n• Brand/Manufacturer\n• Condition (e.g., "headache", "fever")`;
                }
                return `I couldn't find any products matching "${query}". 😕\n\nTry:\n• Checking spelling (e.g., "Amoxicillin")\n• Using generic names\n• Searching by category (e.g., "antibiotics")\n• Searching by brand/manufacturer\n\nOr describe your symptoms and I'll suggest products!`;
            }
        
        case 'appointment':
            return "I can help you book an appointment! 📅\n\nPlease let me know:\n1. What type of doctor or service you need\n2. Your preferred date and time\n\nOr I can show you available doctors right away.";
        
        case 'info':
            return "I'd be happy to provide information! 📚\n\nPlease note that while I can offer general health information, for medical advice specific to your situation, I recommend consulting with one of our healthcare professionals.";
        
        default:
            return "I'm here to help! 👋 You can:\n\n• 💊 Search for medicines & health products\n• 📅 Book appointments with doctors\n• 📚 Get general health information\n• 🛒 Order medications directly\n\nWhat would you like to do?";
    }
};

// Main chatbot controller - supports both authenticated users and guests
export const sendMessage = async (req: Request, res: Response): Promise<void> => {
    try {
        const { message, userId, sessionId } = req.body as ChatbotRequest;
        
        // Message is required
        if (!message) {
            res.status(400).json({ 
                success: false, 
                message: 'Message is required' 
            });
            return;
        }

        // Either userId or sessionId must be provided
        if (!userId && !sessionId) {
            res.status(400).json({ 
                success: false, 
                message: 'Either userId or sessionId is required' 
            });
            return;
        }
        
        // Generate or use provided sessionId
        const session = sessionId || `session_${Date.now()}_${userId || 'guest'}`;
        
        // For guest users, use null userId
        const effectiveUserId = userId ? new mongoose.Types.ObjectId(userId) : null;
        
        // Detect intent
        const intent = detectIntent(message);
        
        // Search for products if buy intent
        let products: any[] = [];
        if (intent === 'buy') {
            const productQuery = extractProductKeywords(message);
            products = await searchProducts(productQuery);
        }
        
        // Generate bot response
        const botResponse = generateBotResponse(intent, products, message);
        
        // Find or create conversation
        let conversation = await ChatConversation.findOne({ 
            sessionId: session,
            isActive: true 
        });
        
        if (!conversation) {
            conversation = new ChatConversation({
                userId: effectiveUserId,
                sessionId: session,
                messages: []
            });
        }
        
        // Add user message
        const userMsg: IMessage = {
            sender: 'user',
            text: message,
            intent: intent,
            timestamp: new Date()
        };
        conversation.messages.push(userMsg);
        
        // Add bot message with product IDs
        const productIds = products.map(p => {
            const id = p._id;
            return typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id;
        });

        const botMsg: IMessage = {
            sender: 'bot',
            text: botResponse,
            products: productIds,
            intent: intent,
            timestamp: new Date()
        };
        conversation.messages.push(botMsg);
        
        await conversation.save();
        
        // Return response with product details
        const response: ChatbotResponse = {
            success: true,
            response: botResponse,
            intent: intent,
            products: products.map(p => ({
                _id: p._id,
                partnerId: p.partnerId,
                partnerProductId: p.partnerProductId,
                drugId: p.drugId,
                name: p.name,
                sku: p.sku,
                imageUrl: p.imageUrl,
                categoryName: p.categoryName,
                prescriptionRequired: p.prescriptionRequired,
                manufacturerName: p.manufacturerName,
                price: p.price,
                expired: p.expired,
                stockQuantity: p.stockQuantity,
                status: p.status
            })),
            sessionId: session
        };
        
        res.status(200).json(response);
        
    } catch (error: any) {
        console.error('Chatbot error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error processing your message',
            error: error.message 
        });
    }
};

// Get conversation history - works with sessionId only
export const getConversationHistory = async (req: Request, res: Response): Promise<void> => {
    try {
        const { sessionId } = req.params;
        
        if (!sessionId) {
            res.status(400).json({ 
                success: false, 
                message: 'SessionId is required' 
            });
            return;
        }
        
        const conversation = await ChatConversation.findOne({ 
            sessionId 
        }).populate('messages.products');
        
        if (!conversation) {
            res.status(404).json({ 
                success: false, 
                message: 'Conversation not found' 
            });
            return;
        }
        
        res.status(200).json({
            success: true,
            conversation
        });
        
    } catch (error: any) {
        console.error('Error fetching conversation:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error fetching conversation history',
            error: error.message 
        });
    }
};

// Clear conversation - works with sessionId only
export const clearConversation = async (req: Request, res: Response): Promise<void> => {
    try {
        const { sessionId } = req.params;
        
        if (!sessionId) {
            res.status(400).json({ 
                success: false, 
                message: 'SessionId is required' 
            });
            return;
        }
        
        const conversation = await ChatConversation.findOneAndUpdate(
            { sessionId },
            { messages: [], isActive: false },
            { new: true }
        );
        
        if (!conversation) {
            res.status(404).json({ 
                success: false, 
                message: 'Conversation not found' 
            });
            return;
        }
        
        res.status(200).json({
            success: true,
            message: 'Conversation cleared successfully'
        });
        
    } catch (error: any) {
        console.error('Error clearing conversation:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error clearing conversation',
            error: error.message 
        });
    }
};

// Get all active conversations for a user (authenticated users only)
export const getUserConversations = async (req: Request, res: Response): Promise<void> => {
    try {
        const { userId } = req.params;
        
        if (!userId) {
            res.status(400).json({ 
                success: false, 
                message: 'UserId is required' 
            });
            return;
        }
        
        const conversations = await ChatConversation.find({ 
            userId: new mongoose.Types.ObjectId(userId),
            isActive: true 
        })
        .sort({ lastActivity: -1 })
        .select('sessionId lastActivity messages')
        .lean();
        
        res.status(200).json({
            success: true,
            count: conversations.length,
            conversations
        });
        
    } catch (error: any) {
        console.error('Error fetching user conversations:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error fetching conversations',
            error: error.message 
        });
    }
};