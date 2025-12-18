import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { Product, IProduct } from '../models/product';
import { ChatConversation, IMessage } from '../models/ChatConversation';
import { Intent, ChatbotRequest, ChatbotResponse } from '../types/chatbot.types';

// Helper function to detect user intent
const detectIntent = (message: string): Intent => {
  const m = message.toLowerCase();

  // 1️⃣ REPRODUCTIVE / SEXUAL HEALTH (TOP PRIORITY)
  const healthKeywords = [
    'period', 'menstrual', 'ovulation', 'fertility',
    'pregnant', 'pregnancy', 'missed period',
    'contraception', 'birth control', 'iud', 'implant',
    'condom', 'safe sex', 'sex', 'sexual',
    'std', 'sti', 'infection', 'discharge',
    'hormone', 'hormonal', 'cramps',
    'emergency contraception', 'postinor',
    'abortion', 'miscarriage'
  ];

  if (healthKeywords.some(k => m.includes(k))) {
    return 'health';
  }

  // 2️⃣ Appointment
  if (
    ['appointment', 'book', 'schedule', 'doctor', 'consultation']
      .some(k => m.includes(k))
  ) {
    return 'appointment';
  }

  // 3️⃣ Buy (INTENTIONAL PURCHASE ONLY)
  if (
    ['buy', 'order', 'purchase', 'add to cart']
      .some(k => m.includes(k))
  ) {
    return 'buy';
  }

  // 4️⃣ Information
  if (
    ['what is', 'how', 'why', 'explain', 'tell me about']
      .some(k => m.includes(k))
  ) {
    return 'info';
  }

  // 5️⃣ Greeting
  if (['hi', 'hello', 'hey'].some(k => m.startsWith(k))) {
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
const generateBotResponse = (
  intent: Intent,
  products: any[],
  userMessage: string
): string => {

  switch (intent) {

    case 'health':
      return `
I’m glad you asked 💗  

I can help explain reproductive and sexual health topics in a clear, safe, and judgment-free way.

Based on your question:
• I’ll share general health information  
• I won’t diagnose or pressure you  
• I’ll suggest seeing a doctor only if needed  

Please tell me a bit more so I can help better.
`;

    case 'buy':
      if (products.length > 0) {
        return `I found ${products.length} option(s) for you. You can review them below and add any to your cart if you wish 🛒`;
      }
      return `I couldn’t find matching products. Please try a specific product name or brand.`;

    case 'appointment':
      return `
I can help you book a confidential appointment 👩‍⚕️  

Tell me:
• What kind of care you need  
• When you’re available
`;

    case 'greeting':
      return `
Hello 👋  
I’m **Ask AmWell**, your confidential reproductive health assistant.

You can ask me questions about:
• Periods & fertility  
• Contraception & pregnancy  
• Sexual health & STIs  
• General reproductive concerns
`;

    default:
      return `
I’m here to support you 💬  

You can:
• Ask health questions  
• Learn about reproductive wellness  
• Book a doctor when needed  
• Order products only if you choose
`;
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