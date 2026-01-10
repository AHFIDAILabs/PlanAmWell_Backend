import { Request, Response } from 'express';
import mongoose from 'mongoose';
import OpenAI from 'openai';

import { Product } from '../models/product';
import { ChatConversation, IMessage } from '../models/ChatConversation';
import { Intent, ChatbotRequest } from '../types/chatbot.types';
import { uploadVideoToCloudinary } from '../middleware/claudinary';
import multer from 'multer';

// --- CONFIGURATION ---
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 } 
});

const openrouter = new OpenAI({ 
    apiKey: process.env.OPENAI_API_KEY, 
    baseURL: "https://openrouter.ai/api/v1" 
});

const openaiWhisper = new OpenAI({ 
    apiKey: process.env.WHISPER_API_KEY 
});

// --- HELPER FUNCTIONS ---

export const getGPTResponse = async (userPrompt: string, history: any[] = []): Promise<string> => {
    const systemMessage: OpenAI.Chat.ChatCompletionMessageParam = {
        role: 'system',
        content: `You are "Ask AmWell", a professional reproductive health assistant. 
        Provide medically-sound info on periods, fertility, and contraception. 
        Be empathetic and confidential. If there's an emergency, advise seeing a doctor.`
    };

    const formattedHistory: OpenAI.Chat.ChatCompletionMessageParam[] = history.slice(-6).map(msg => ({
        role: (msg.sender === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: msg.text
    }));

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        systemMessage,
        ...formattedHistory,
        { role: 'user' as const, content: userPrompt }
    ];

    const completion = await openrouter.chat.completions.create({
        model: 'openai/gpt-4o-mini',
        messages: messages,
        temperature: 0.7,
        max_tokens: 300,
    });

    return completion.choices[0].message?.content || 'I am having trouble connecting right now.';
};

export const transcribeAudio = [
    upload.single('file'),
    async (req: Request, res: Response): Promise<Response> => {
        try {
            if (!req.file) {
                return res.status(400).json({ success: false, message: 'No file uploaded' });
            }

            const { videoUrl, videoCldId } = await uploadVideoToCloudinary(
                req.file.buffer, 
                'whisper-audio'
            );

            // console.log('✅ Audio uploaded to Cloudinary as media:', videoUrl);

            const transcription = await openaiWhisper.audio.transcriptions.create({
                file: await OpenAI.toFile(req.file.buffer, 'speech.m4a'),
                model: 'whisper-1',
            });

            return res.status(200).json({
                success: true,
                text: transcription.text || '',
                cloudinaryId: videoCldId,
                cloudinaryUrl: videoUrl,
            });

        } catch (error: any) {
            console.error('Whisper transcription error:', error);
            
            if (error.status === 413) {
                return res.status(413).json({ 
                    success: false, 
                    message: 'Audio file too large for processing' 
                });
            }

            return res.status(500).json({
                success: false,
                message: 'Error transcribing audio',
                error: error.message,
            });
        }
    }
];

// --- INTENT & PRODUCT HELPERS ---

const detectIntent = (message: string): Intent => {
    const m = message.toLowerCase().trim();
    if (['hi', 'hello', 'hey'].some(k => m.startsWith(k)) && m.split(' ').length <= 3) return 'greeting';
    if (['buy', 'order', 'purchase', 'add to cart', 'price'].some(k => m.includes(k))) return 'buy';
    if (['appointment', 'book', 'doctor'].some(k => m.includes(k))) return 'appointment';
    
    const healthKeywords = ['period', 'menstrual', 'fertility', 'pregnant', 'contraception', 'postinor', 'infection'];
    if (healthKeywords.some(k => m.includes(k))) return 'health';
    
    return 'general';
};

const extractProductKeywords = (message: string): string => {
    let cleaned = message.toLowerCase().trim();
    
    // Remove common purchase intent phrases
    const purchasePhrases = [
        'i want to buy', 'i need to buy', 'i want to purchase', 'i need to purchase', 'i would like to order', 
        'i want to order', 'i need to order', 'i would like to buy', 'i would like to purchase',
        'can i buy', 'can i get', 'can i order', 'can i purchase',
        'i want', 'i need', 'i require', 'get me', 'buy me',
        'buy', 'order', 'purchase', 'get'
    ];
    
    // Sort by length (longest first) to match longer phrases first
    purchasePhrases.sort((a, b) => b.length - a.length);
    
    for (const phrase of purchasePhrases) {
        if (cleaned.startsWith(phrase)) {
            cleaned = cleaned.replace(phrase, '').trim();
            break;
        }
    }
    
    // Remove articles and common connectors
    const fillerWords = ['a', 'an', 'the', 'some', 'any'];
    const words = cleaned.split(' ');
    const filteredWords = words.filter(word => !fillerWords.includes(word));
    
    // Clean special characters but keep spaces
    return filteredWords.join(' ').replace(/[^a-zA-Z0-9 ]/g, "").trim();
};

const searchProducts = async (query: string, limit: number = 5): Promise<any[]> => {
    if (!query || !query.trim()) return [];
    return await Product.find({
        $and: [
            { $or: [{ name: { $regex: query, $options: 'i' } }, { categoryName: { $regex: query, $options: 'i' } }] },
            { stockQuantity: { $gt: 0 } },
            { status: { $ne: 'inactive' } }
        ]
    }).limit(limit).lean();
};

/**
 * NEW: Infer category from user query using common mappings
 */
const inferCategory = (query: string): string | null => {
    const q = query.toLowerCase().trim();
    
    // Category mapping for common reproductive health products
    const categoryMap: { [key: string]: string[] } = {
        'contraceptive': ['condom', 'contraceptive', 'birth control', 'protection', 'safe sex'],
        'emergency contraceptive': ['postinor', 'morning after', 'emergency pill', 'plan b'],
        'fertility': ['ovulation', 'pregnancy test', 'fertility monitor', 'conception'],
        'menstrual care': ['pad', 'tampon', 'menstrual cup', 'period', 'sanitary'],
        'vitamins': ['prenatal', 'folic acid', 'supplement', 'vitamin'],
        'intimate care': ['lubricant', 'wash', 'hygiene', 'intimate'],
    };
    
    for (const [category, keywords] of Object.entries(categoryMap)) {
        if (keywords.some(keyword => q.includes(keyword))) {
            return category;
        }
    }
    
    return null;
};

/**
 * NEW: Search products by category
 */
const searchProductsByCategory = async (category: string, limit: number = 5): Promise<any[]> => {
    if (!category || !category.trim()) return [];
    return await Product.find({
        $and: [
            { categoryName: { $regex: category, $options: 'i' } },
            { stockQuantity: { $gt: 0 } },
            { status: { $ne: 'inactive' } }
        ]
    }).limit(limit).lean();
};

// --- CONTROLLERS ---
export const sendMessage = [
    upload.single('file'),
    async (req: Request, res: Response): Promise<Response> => {
        try {
            const { message: textMessage, userId, sessionId } = req.body as ChatbotRequest;
            const session = sessionId || `session_${Date.now()}`;
            const effectiveUserId = userId ? new mongoose.Types.ObjectId(userId) : null;

            let userText = textMessage || '';
            let audioData;

            // 1. Voice handling
            if (req.file) {
                const { videoUrl, videoCldId } = await uploadVideoToCloudinary(
                    req.file.buffer, 
                    'whisper-audio'
                );
                
                const transcription = await openaiWhisper.audio.transcriptions.create({
                    file: await OpenAI.toFile(req.file.buffer, 'speech.m4a'),
                    model: 'whisper-1',
                });

                userText = transcription.text || '';
                audioData = { 
                    cloudinaryId: videoCldId, 
                    cloudinaryUrl: videoUrl 
                };

                // console.log('✅ Voice Uploaded as Media & Transcribed:', userText);
            }

            // 2. Fetch/Create Conversation
            let conversation = await ChatConversation.findOne({ sessionId: session, isActive: true });
            if (!conversation) {
                conversation = new ChatConversation({ userId: effectiveUserId, sessionId: session, messages: [] });
            }

            // 3. Logic: Intent & Response
            const intent = detectIntent(userText);
            let botResponseText = '';
            let products: any[] = [];

            if (intent === 'buy') {
                const query = extractProductKeywords(userText);
                products = await searchProducts(query);
                
                // ENHANCED: Category fallback when exact product not found
                if (products.length === 0) {
                    const inferredCategory = inferCategory(query);
                    
                    if (inferredCategory) {
                        products = await searchProductsByCategory(inferredCategory);
                        
                        if (products.length > 0) {
                            botResponseText = `We currently don't have "${query}" in stock, but here are some ${inferredCategory} products available. 🛒`;
                        } else {
                            botResponseText = `Sorry, we don't have "${query}" available at the moment. Please check back later or contact support for assistance.`;
                        }
                    } else {
                        // Try a broader search if no category inferred
                        const broadProducts = await Product.find({
                            $and: [
                                { stockQuantity: { $gt: 0 } },
                                { status: { $ne: 'inactive' } }
                            ]
                        }).limit(5).lean();
                        
                        if (broadProducts.length > 0) {
                            products = broadProducts;
                            botResponseText = `We currently don't have "${query}" in our store. Here are some popular health products you might be interested in. 🛒`;
                        } else {
                            botResponseText = `We don't have "${query}" available at the moment. Please check back later or ask me about other reproductive health topics.`;
                        }
                    }
                } else {
                    botResponseText = `Great! I found some options for you. 🛒`;
                }
            } else if (intent === 'greeting') {
                botResponseText = "Hello 👋 I'm Ask AmWell. How can I help you today?";
            } else {
                // OpenAI handles health/info/general
                botResponseText = await getGPTResponse(userText, conversation.messages);
                
                // Smart search: Attach products if mentioned
                const possibleKeywords = extractProductKeywords(userText);
                const suggestedProducts = await searchProducts(possibleKeywords, 2); 
                if (suggestedProducts.length > 0) products = suggestedProducts;
            }

            // 4. Save to DB
            const userMsg: IMessage = { 
                sender: 'user', 
                text: userText, 
                intent, 
                timestamp: new Date(), 
                audio: audioData 
            };
            const botMsg: IMessage = { 
                sender: 'bot', 
                text: botResponseText, 
                intent, 
                timestamp: new Date(), 
                products: products.map(p => p._id) 
            };
            
            conversation.messages.push(userMsg, botMsg);
            conversation.lastActivity = new Date();
            if (conversation.messages.length > 50) {
                conversation.messages = conversation.messages.slice(-50);
            }
            await conversation.save();

            // 5. Final JSON Response
            return res.status(200).json({
                success: true,
                response: botResponseText,
                intent,
                products,
                sessionId: session,
                audio: audioData
            });

        } catch (error: any) {
            console.error('Chatbot error:', error);
            if (error.status === 413) {
                return res.status(413).json({ success: false, message: 'Audio file is too large.' });
            }
            return res.status(500).json({ success: false, message: 'Server error' });
        }
    }
];

export const getConversationHistory = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { sessionId } = req.params;
    const userId = req.query.userId as string | undefined; // Type assertion

    if (!sessionId && !userId) {
      return res.status(400).json({ 
        success: false, 
        message: 'SessionId or UserId is required' 
      });
    }

    // Build query based on what's available
    let query: any = {};
    
    if (userId) {
      // For registered users: prioritize userId
      // Validate userId is a valid ObjectId before converting
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid userId format' 
        });
      }
      
      query = { 
        userId: new mongoose.Types.ObjectId(userId),
        isActive: true 
      };
    } else if (sessionId) {
      // For guest users: use sessionId
      query = { 
        sessionId,
        isActive: true 
      };
    }

    const conversation = await ChatConversation.findOne(query)
      .sort({ lastActivity: -1 }) // Get most recent conversation
      .populate('messages.products')
      .lean();
    
    if (!conversation) {
      return res.status(404).json({ 
        success: false, 
        message: 'Conversation not found' 
      });
    }

    return res.status(200).json({ 
      success: true, 
      conversation 
    });
  } catch (error: any) {
    console.error('Error fetching conversation history:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Error fetching conversation history', 
      error: error.message 
    });
  }
};

export const clearConversation = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { sessionId } = req.params;
    if(!sessionId) return res.status(400).json({ success:false, message:'SessionId is required' });

    const conversation = await ChatConversation.findOneAndUpdate(
      { sessionId },
      { messages:[], isActive:false },
      { new:true }
    );
    if(!conversation) return res.status(404).json({ success:false, message:'Conversation not found' });

    return res.status(200).json({ success:true, message:'Conversation cleared successfully' });
  } catch(error:any){
    console.error(error);
    return res.status(500).json({ success:false, message:'Error clearing conversation', error:error.message });
  }
};

export const getUserConversations = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { userId } = req.params;
    if(!userId) return res.status(400).json({ success:false, message:'UserId is required' });

    const conversations = await ChatConversation.find({ userId:new mongoose.Types.ObjectId(userId), isActive:true })
      .sort({ lastActivity:-1 })
      .select('sessionId lastActivity messages')
      .lean();

    return res.status(200).json({ success:true, count:conversations.length, conversations });
  } catch(error:any){
    console.error(error);
    return res.status(500).json({ success:false, message:'Error fetching conversations', error:error.message });
  }
};