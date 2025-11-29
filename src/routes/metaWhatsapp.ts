// routes/metaWhatsAppRoutes.ts
import express from 'express';
import { 
    verifyWebhook, 
    handleMetaWebhook 
} from '../controllers/metaWhatsAppController';

const whatsappRouter = express.Router();

// GET - Webhook verification (Meta will call this first)
whatsappRouter.get('/webhook', verifyWebhook);

// POST - Receive messages from WhatsApp
whatsappRouter.post('/webhook', handleMetaWebhook);

// Health check endpoint
whatsappRouter.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'active',
        service: 'Meta WhatsApp Integration',
        timestamp: new Date().toISOString()
    });
});

export default whatsappRouter;