import { Request, Response } from 'express';
import mongoose from 'mongoose';
import fs from 'fs';
import OpenAI from 'openai';

import { Product } from '../models/product';
import { ChatConversation, IMessage } from '../models/ChatConversation';
import { Intent, ChatbotRequest, ChatbotResponse } from '../types/chatbot.types';
import { uploadDocumentToCloudinary, uploadVideoToCloudinary } from '../middleware/claudinary';
import multer from 'multer';


const upload = multer({ storage: multer.memoryStorage() }); // keep file in memory

// chatbotController.ts

const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY, // This is your sk-or-v1... key
  baseURL: "https://openrouter.ai/api/v1", // THIS IS THE MISSING PIECE
});
// Transcribe audio (Whisper)
export const transcribeAudio = [
  upload.single('file'),
  async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
      }

      // Upload audio to Cloudinary
      const { fileUrl, fileCldId } = await uploadDocumentToCloudinary(
        req.file.buffer,
        'whisper-audio',
        req.file.mimetype
      );

      console.log('✅ Audio uploaded to Cloudinary:', fileUrl);

      // Transcribe audio from buffer (Whisper requires a stream/file)
      const transcription = await openai.audio.transcriptions.create({
        file: req.file.buffer as any, // buffer works with OpenAI v5
        model: 'whisper-1',
      });

      return res.status(200).json({
        success: true,
        text: transcription.text || '',
        cloudinaryId: fileCldId,
        cloudinaryUrl: fileUrl,
      });

    } catch (error: any) {
      console.error('Whisper transcription error:', error);
      return res.status(500).json({
        success: false,
        message: 'Error transcribing audio',
        error: error.message,
      });
    }
  }
];


// --- Helper Functions ---
export const getGPTResponse = async (userPrompt: string, history: any[] = []): Promise<string> => {
    
    // 1. Explicitly type the system message
    const systemMessage: OpenAI.Chat.ChatCompletionMessageParam = {
        role: 'system',
        content: `You are "Ask AmWell", a highly empathetic and professional reproductive health assistant. 
        Provide accurate, medically-sound information about periods, fertility, contraception, and STIs. 
        Always be confidential and supportive. If a situation sounds like a medical emergency, advise the user to seek immediate professional help.`
    };

    // 2. Map history and cast the role specifically
    const formattedHistory: OpenAI.Chat.ChatCompletionMessageParam[] = history.slice(-5).map(msg => ({
        role: (msg.sender === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: msg.text
    }));

    // 3. Combine them into a typed array
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        systemMessage,
        ...formattedHistory,
        { role: 'user' as const, content: userPrompt }
    ];

 // Inside getGPTResponse
const completion = await openai.chat.completions.create({
    model: 'openai/gpt-4', 
    messages: messages,
    temperature: 0.7,
    max_tokens: 250, // Limit response length so it's "cheaper" to start
});

    return completion.choices[0].message?.content || 'I am having trouble connecting right now. Please try again.';
};
// --- Intent & Product Helpers ---
const detectIntent = (message: string): Intent => {
  const m = message.toLowerCase().trim();

  // 1. GREETINGS (Check first for quick exit)
  const greetingKeywords = ['hi', 'hello', 'hey', 'good morning', 'good afternoon'];
  if (greetingKeywords.some(k => m.startsWith(k)) && m.split(' ').length <= 3) {
    return 'greeting';
  }

  // 2. BUY/COMMERCE (High Priority)
  // If they use buying verbs OR mention "cart"/"price"/"cost"
  const purchaseKeywords = ['buy', 'order', 'purchase', 'add to cart', 'price', 'cost', 'how much is'];
  if (purchaseKeywords.some(k => m.includes(k))) return 'buy';

  // 3. APPOINTMENTS
  const appointmentKeywords = ['appointment', 'book', 'schedule', 'doctor', 'consultation', 'see a nurse'];
  if (appointmentKeywords.some(k => m.includes(k))) return 'appointment';

  // 4. REPRODUCTIVE HEALTH (Specific medical terms)
  const healthKeywords = [
    'period', 'menstrual', 'ovulation', 'fertility', 'pregnant', 'pregnancy', 
    'missed period', 'contraception', 'birth control', 'iud', 'implant', 
    'condom', 'safe sex', 'sex', 'sexual', 'std', 'sti', 'infection', 
    'discharge', 'hormone', 'hormonal', 'cramps', 'postinor', 'abortion', 'miscarriage'
  ];
  if (healthKeywords.some(k => m.includes(k))) {
    // If they ask "What is postinor", it's info. 
    // If they just say "postinor", we treat it as health for OpenAI to explain.
    return 'health';
  }

  // 5. GENERAL INFO
  const infoKeywords = ['what is', 'how to', 'why', 'explain', 'tell me about', 'meaning of'];
  if (infoKeywords.some(k => m.includes(k))) return 'info';

  return 'general';
};

const extractProductKeywords = (message: string): string => {
  let cleaned = message.toLowerCase().trim();
  const leadingPhrases = [
    'i would like to','would like to','i want to','want to',
    'i need to','need to','looking for','search for',
    'find me','show me','give me','get me','i need',
    'need','buy','order','purchase','get','find'
  ];
  leadingPhrases.forEach(phrase => {
    if (cleaned.startsWith(phrase)) cleaned = cleaned.substring(phrase.length).trim();
  });

  const trailingPhrases = ['please','plz','pls','thanks','thank you'];
  trailingPhrases.forEach(phrase => {
    if (cleaned.endsWith(phrase)) cleaned = cleaned.substring(0, cleaned.length - phrase.length).trim();
  });

  const articles = ['a ','an ','the ','some '];
  articles.forEach(article => {
    if (cleaned.startsWith(article)) cleaned = cleaned.substring(article.length).trim();
  });

  return cleaned.replace(/\s+/g, ' ').trim();
};

const searchProducts = async (query: string, limit: number = 5): Promise<any[]> => {
  if (!query || !query.trim()) return [];
  const cleanedQuery = query.toLowerCase().replace(/[^\w\s]/g,' ').replace(/\s+/g,' ').trim();
  const searchTerms = cleanedQuery.split(' ').filter(term => term.length > 2);
  if (searchTerms.length === 0) return [];

  const orConditions: any[] = [];
  searchTerms.forEach(term => {
    orConditions.push(
      { name: { $regex: term, $options: 'i' } },
      { categoryName: { $regex: term, $options: 'i' } },
      { manufacturerName: { $regex: term, $options: 'i' } },
      { sku: { $regex: term, $options: 'i' } }
    );
  });
  if (cleanedQuery !== searchTerms[0]) {
    orConditions.push(
      { name: { $regex: cleanedQuery, $options: 'i' } },
      { categoryName: { $regex: cleanedQuery, $options: 'i' } },
      { manufacturerName: { $regex: cleanedQuery, $options: 'i' } }
    );
  }

  return await Product.find({
    $and: [
      { $or: orConditions },
      { stockQuantity: { $gt: 0 } },
      { status: { $ne: 'inactive' } }
    ]
  }).limit(limit).lean();
};

const generateBotResponse = (intent: Intent, products: any[], userMessage: string): string => {
  switch(intent){
    case 'health': return `I’m glad you asked 💗\nPlease tell me a bit more so I can help better.`;
    case 'buy': return products.length>0 ? `I found ${products.length} option(s) for you. 🛒` : `I couldn’t find matching products.`;
    case 'appointment': return `I can help you book a confidential appointment 👩‍⚕️`;
    case 'greeting': return `Hello 👋 I’m Ask AmWell, your confidential reproductive health assistant.`;
    default: return `I’m here to support you 💬 You can ask health questions, learn about reproductive wellness, book doctors, or order products.`;
  }
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

            // 1. Voice handling with OpenAI-compatible File wrapping
            if (req.file) {
                // Upload to Cloudinary so we have a record of the audio
                const { fileUrl, fileCldId } = await uploadDocumentToCloudinary(
                    req.file.buffer, 
                    'whisper-audio', 
                    req.file.mimetype
                );
                
                // Transcribe using OpenAI Whisper
                // We use OpenAI.toFile to ensure the buffer is treated as a file
                const transcription = await openai.audio.transcriptions.create({
                    file: await OpenAI.toFile(req.file.buffer, 'speech.m4a'),
                    model: 'whisper-1',
                });

                userText = transcription.text || '';
                audioData = { cloudinaryId: fileCldId, cloudinaryUrl: fileUrl };
                console.log('✅ Voice Transcribed:', userText);
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
                    ? `I found ${products.length} product(s) for you. 🛒` 
                    : `I couldn't find "${query}" in our shop, but I'm here to help with other questions!`;
            } else if (intent === 'greeting') {
                botResponseText = "Hello 👋 I’m Ask AmWell, your health assistant. How can I help you today?";
            } else {
                // OpenAI for health, info, or general
                botResponseText = await getGPTResponse(userText, conversation.messages);

                // Fallback: If they mention a drug in a health question, show the product!
                const possibleKeywords = extractProductKeywords(userText);
                const suggestedProducts = await searchProducts(possibleKeywords, 2); 
                if (suggestedProducts.length > 0) {
                    products = suggestedProducts;
                }
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

            // 5. Final Response
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
            // Handle the "Too Large" error specifically if it still hits
            if (error.status === 413) {
                return res.status(413).json({ success: false, message: 'Audio file is too large. Please keep it under 30 seconds.' });
            }
            return res.status(500).json({ success: false, message: 'Error processing message' });
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
