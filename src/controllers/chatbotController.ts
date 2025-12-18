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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

// GPT response
export const getGPTResponse = async (prompt: string): Promise<string> => {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
  });

  return completion.choices[0].message?.content || '';
};

// --- Intent & Product Helpers ---
const detectIntent = (message: string): Intent => {
  const m = message.toLowerCase();
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

  if (healthKeywords.some(k => m.includes(k))) return 'health';
  if (['appointment', 'book', 'schedule', 'doctor', 'consultation'].some(k => m.includes(k))) return 'appointment';
  if (['buy', 'order', 'purchase', 'add to cart'].some(k => m.includes(k))) return 'buy';
  if (['what is', 'how', 'why', 'explain', 'tell me about'].some(k => m.includes(k))) return 'info';
  if (['hi', 'hello', 'hey'].some(k => m.startsWith(k))) return 'greeting';

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
  upload.single('file'), // optional audio file
  async (req: Request, res: Response): Promise<Response> => {
    try {
      const { message: textMessage, userId, sessionId } = req.body as ChatbotRequest;

      if (!textMessage && !req.file) {
        return res.status(400).json({ success:false, message:'Message text or audio file is required' });
      }

      const session = sessionId || `session_${Date.now()}_${userId||'guest'}`;
      const effectiveUserId = userId ? new mongoose.Types.ObjectId(userId) : null;

      let message = textMessage;

      // --- AUDIO TRANSCRIPTION ---
      let audioCloudinaryId: string | null = null;
      let audioCloudinaryUrl: string | null = null;

      if (req.file) {
        const { fileUrl, fileCldId } = await uploadDocumentToCloudinary(
          req.file.buffer,
          'whisper-audio',
          req.file.mimetype
        );
        audioCloudinaryId = fileCldId;
        audioCloudinaryUrl = fileUrl;

        const transcription = await openai.audio.transcriptions.create({
          file: req.file.buffer as any,
          model: 'whisper-1',
        });

        message = transcription.text || '';
        console.log('✅ Audio transcribed:', message);
      }

      // --- DETECT INTENT & PRODUCTS ---
      const intent = detectIntent(message);
      let products: any[] = [];
      if(intent === 'buy') products = await searchProducts(extractProductKeywords(message));

      const botResponse = generateBotResponse(intent, products, message);

      // --- SAVE CONVERSATION ---
      let conversation = await ChatConversation.findOne({ sessionId: session, isActive:true });
      if(!conversation){
        conversation = new ChatConversation({ userId: effectiveUserId, sessionId: session, messages: [] });
      }

      // User message
      const userMsg: IMessage = {
        sender: 'user',
        text: message,
        intent,
        timestamp: new Date(),
        audio: req.file ? { cloudinaryId: audioCloudinaryId!, cloudinaryUrl: audioCloudinaryUrl! } : undefined
      };
      conversation.messages.push(userMsg);

      // Bot message
      const botMsg: IMessage = {
        sender: 'bot',
        text: botResponse,
        products: products.map(p => p._id),
        intent,
        timestamp: new Date()
      };
      conversation.messages.push(botMsg);

      await conversation.save();

      return res.status(200).json({
        success:true,
        response: botResponse,
        intent,
        products,
        sessionId: session,
        audio: req.file ? { cloudinaryId: audioCloudinaryId, cloudinaryUrl: audioCloudinaryUrl } : undefined
      });

    } catch (error:any) {
      console.error('Chatbot error:', error);
      return res.status(500).json({ success:false, message:'Error processing your message', error:error.message });
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
