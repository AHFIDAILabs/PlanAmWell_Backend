import { Request, Response } from 'express';
import mongoose from 'mongoose';
import OpenAI from 'openai';

import { Product } from '../models/product';
import { ChatConversation, IMessage } from '../models/ChatConversation';
import { Intent, ChatbotRequest } from '../types/chatbot.types';
import {  uploadVideoToCloudinary } from '../middleware/claudinary';
import multer from 'multer';

// --- CONFIGURATION ---
// Increase Multer limit to 25MB to match Whisper's maximum allowed size
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 } 
});

// Instance 1: OpenRouter for Chat (Text)
const openrouter = new OpenAI({ 
    apiKey: process.env.OPENAI_API_KEY, 
    baseURL: "https://openrouter.ai/api/v1" 
});

// Instance 2: Direct OpenAI for Whisper (Audio)
const openaiWhisper = new OpenAI({ 
    apiKey: process.env.WHISPER_API_KEY 
});

// --- HELPER FUNCTIONS ---

/**
 * Calls OpenRouter for GPT responses with conversation history
 */
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
        model: 'openai/gpt-4o-mini', // Cost-effective model via OpenRouter
        messages: messages,
        temperature: 0.7,
        max_tokens: 300,
    });

    return completion.choices[0].message?.content || 'I am having trouble connecting right now.';
};


// Transcribe audio (Whisper) - Standalone Endpoint
export const transcribeAudio = [
    upload.single('file'),
    async (req: Request, res: Response): Promise<Response> => {
        try {
            if (!req.file) {
                return res.status(400).json({ success: false, message: 'No file uploaded' });
            }

            // 1. Upload to Cloudinary using Video resource type
            // This treats the audio as playable media instead of a raw document
            const { videoUrl, videoCldId } = await uploadVideoToCloudinary(
                req.file.buffer, 
                'whisper-audio'
            );

            console.log('✅ Audio uploaded to Cloudinary as media:', videoUrl);

            // 2. Transcribe audio using the dedicated native OpenAI Whisper instance
            // We use OpenAI.toFile to properly format the buffer for the API
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
            
            // Specifically handle payload size errors if they slip through
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
    const leadingPhrases = ['i want to buy', 'buy', 'order', 'purchase', 'need', 'get me'];
    leadingPhrases.forEach(phrase => {
        if (cleaned.startsWith(phrase)) cleaned = cleaned.replace(phrase, '').trim();
    });
    return cleaned.replace(/[^a-zA-Z0-9 ]/g, "").trim();
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

            // 1. Voice handling: Using uploadVideoToCloudinary for better media handling
            if (req.file) {
                // We use uploadVideoToCloudinary because Cloudinary treats audio as 
                // "video without a picture," enabling streaming and media metadata.
                const { videoUrl, videoCldId } = await uploadVideoToCloudinary(
                    req.file.buffer, 
                    'whisper-audio'
                );
                
                // Transcribe using Direct OpenAI Key (Whisper)
                const transcription = await openaiWhisper.audio.transcriptions.create({
                    file: await OpenAI.toFile(req.file.buffer, 'speech.m4a'),
                    model: 'whisper-1',
                });

                userText = transcription.text || '';
                
                // Note: using videoUrl/videoCldId from the helper response
                audioData = { 
                    cloudinaryId: videoCldId, 
                    cloudinaryUrl: videoUrl 
                };

                console.log('✅ Voice Uploaded as Media & Transcribed:', userText);
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
                botResponseText = products.length > 0 
                    ? `I found some options for you. 🛒` 
                    : `I couldn't find "${query}" in our shop.`;
            } else if (intent === 'greeting') {
                botResponseText = "Hello 👋 I’m Ask AmWell. How can I help you today?";
            } else {
                // OpenAI (via OpenRouter) handles health/info/general
                botResponseText = await getGPTResponse(userText, conversation.messages);
                
                // Smart search: Attach products if they were mentioned in the chat
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
    if(!sessionId) return res.status(400).json({ success:false, message:'SessionId is required' });

    const conversation = await ChatConversation.findOne({ sessionId }).populate('messages.products');
    if(!conversation) return res.status(404).json({ success:false, message:'Conversation not found' });

    return res.status(200).json({ success:true, conversation });
  } catch (error:any){
    console.error(error);
    return res.status(500).json({ success:false, message:'Error fetching conversation history', error:error.message });
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
