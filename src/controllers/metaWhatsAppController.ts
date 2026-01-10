// controllers/metaWhatsAppController.ts
import { Request, Response } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { Product } from '../models/product';
import { ChatConversation, IMessage } from '../models/ChatConversation';
import { Intent } from '../types/chatbot.types';

// Environment variables
const WEBHOOK_VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN || 'your_verify_token';
const META_ACCESS_TOKEN = process.env.META_WHATSAPP_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;
const META_APP_SECRET = process.env.META_APP_SECRET;
const META_API_VERSION = 'v21.0'; // Updated to latest version
const APP_URL = process.env.APP_URL || 'https://amwell.com';
const SUPPORT_PHONE = process.env.SUPPORT_PHONE || '+234-XXX-XXXX';

// ============================================
// HELPER FUNCTIONS
// ============================================

// ✅ Extract product keywords from message
const extractProductKeywords = (message: string): string => {
    let cleaned = message.toLowerCase().trim();
    
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
    
    const trailingPhrases = ['please', 'plz', 'pls', 'thanks', 'thank you'];
    for (const phrase of trailingPhrases) {
        if (cleaned.endsWith(phrase)) {
            cleaned = cleaned.substring(0, cleaned.length - phrase.length).trim();
        }
    }
    
    const articles = ['a ', 'an ', 'the ', 'some '];
    for (const article of articles) {
        if (cleaned.startsWith(article)) {
            cleaned = cleaned.substring(article.length);
            break;
        }
    }
    
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    
    // console.log(`📝 WhatsApp - Original: "${message}" → Extracted: "${cleaned}"`);
    
    return cleaned;
};

// ✅ Detect user intent
const detectIntent = (message: string): Intent => {
    const lowerMessage = message.toLowerCase();
    
    // Greeting
    const greetingKeywords = ['hi', 'hello', 'hey', 'good morning', 'good afternoon', 'good evening', 'start', 'begin'];
    if (greetingKeywords.some(keyword => lowerMessage.startsWith(keyword))) {
        return 'greeting';
    }
    
    // Buy intent
    const buyKeywords = ['buy', 'order', 'purchase', 'get', 'need', 'want', 'looking for', 'shop', 'cart', 'add'];
    if (buyKeywords.some(keyword => lowerMessage.includes(keyword))) {
        return 'buy';
    }
    
    // Appointment intent
    const appointmentKeywords = ['appointment', 'book', 'schedule', 'doctor', 'consultation', 'see a doctor'];
    if (appointmentKeywords.some(keyword => lowerMessage.includes(keyword))) {
        return 'appointment';
    }
    
    // Info/question intent
    const infoKeywords = ['what is', 'how', 'why', 'tell me', 'explain', 'information', 'about'];
    if (infoKeywords.some(keyword => lowerMessage.includes(keyword))) {
        return 'info';
    }
    
    return 'general';
};

// ✅ Search products
const searchProducts = async (query: string, limit: number = 5): Promise<any[]> => {
    try {
        if (!query || query.trim() === '') {
            // console.log('⚠️ Empty search query');
            return [];
        }

        const cleanedQuery = query
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        
        const searchTerms = cleanedQuery.split(' ').filter(term => term.length > 2);
        
        // console.log(`🔍 WhatsApp - Searching for: "${cleanedQuery}"`);
        // console.log(`📋 Search terms: [${searchTerms.join(', ')}]`);
        
        if (searchTerms.length === 0) {
            // console.log('⚠️ No valid search terms');
            return [];
        }

        const orConditions = [];
        
        for (const term of searchTerms) {
            orConditions.push(
                { name: { $regex: term, $options: 'i' } },
                { categoryName: { $regex: term, $options: 'i' } },
                { manufacturerName: { $regex: term, $options: 'i' } },
                { sku: { $regex: term, $options: 'i' } }
            );
        }
        
        if (cleanedQuery !== searchTerms[0]) {
            orConditions.push(
                { name: { $regex: cleanedQuery, $options: 'i' } },
                { categoryName: { $regex: cleanedQuery, $options: 'i' } },
                { manufacturerName: { $regex: cleanedQuery, $options: 'i' } }
            );
        }

        const products = await Product.find({
            $and: [
                { $or: orConditions },
                { stockQuantity: { $gt: 0 } },
                { status: { $ne: 'inactive' } }
            ]
        })
        .limit(limit)
        .lean();
        
        // console.log(`✅ WhatsApp - Found ${products.length} products`);
        if (products.length > 0) {
            // console.log(`📦 Products: ${products.map(p => p.name).join(', ')}`);
        }
        
        return products;
    } catch (error) {
        console.error('❌ WhatsApp - Error searching products:', error);
        return [];
    }
};

// ✅ Generate WhatsApp response
const generateWhatsAppResponse = (intent: Intent, products: any[], userMessage: string): string => {
    switch (intent) {
        case 'greeting':
            return `👋 *Welcome to AmWell Health!*

I'm your AI health assistant. I can help you:

💊 *Find medicines & health products*
📅 *Book doctor appointments*
🛒 *Order directly via WhatsApp*
📍 *Track your orders*

*Quick Commands:*
- Type a product name to search
- Reply *HELP* for assistance
- Reply *ORDERS* to track orders

What can I help you with today?`;
        
        case 'buy':
            if (products.length > 0) {
                let response = `🛒 *Found ${products.length} Product${products.length > 1 ? 's' : ''}:*\n\n`;
                
                products.forEach((product, index) => {
                    response += `*${index + 1}. ${product.name}*\n`;
                    response += `   💰 Price: ₦${product.price.toLocaleString()}\n`;
                    response += `   🏭 Brand: ${product.manufacturerName}\n`;
                    response += `   📦 In Stock: ${product.stockQuantity} units\n`;
                    if (product.prescriptionRequired) {
                        response += `   ⚠️ Prescription Required\n`;
                    }
                    response += `\n`;
                });
                
                response += `\n📝 *To Order:*\n`;
                response += `Reply: *ORDER <number>*\n`;
                response += `Example: *ORDER 1*\n\n`;
                response += `🌐 Or order via app:\n${APP_URL}/products`;
                
                return response;
            } else {
                const query = extractProductKeywords(userMessage);
                if (!query) {
                    return `🔍 *Product Search*

Please tell me what you're looking for:

*Examples:*
- "I need Paracetamol"
- "Show me antibiotics"
- "Pain relief medicine"
- "Amoxicillin"

I'll find the best matches for you! 💊`;
                }
                return `😕 *No products found for "${query}"*

*Suggestions:*
✓ Check spelling
✓ Try generic names (e.g., "Paracetamol" not "Panadol")
✓ Search by category (e.g., "antibiotics", "pain relief")
✓ Try brand names

*Need Help?*
Reply *HELP* or call ${SUPPORT_PHONE}`;
            }
        
        case 'appointment':
            return `📅 *Book a Doctor Appointment*

*How to Book:*
1. Visit our app: ${APP_URL}/appointments
2. Call us: ${SUPPORT_PHONE}
3. Or continue here - tell me:
   • Type of doctor needed
   • Preferred date/time

*Available Specialties:*
- General Practitioner
- Specialist Consultation
- Emergency Care

What works best for you?`;
        
        case 'info':
            return `ℹ️ *Health Information*

I can provide general health information, but for medical advice specific to your condition, please consult our healthcare professionals.

*What would you like to know about?*
- Medications
- Conditions
- Treatments
- Health tips

Or visit: ${APP_URL}/health-info`;
        
        default:
            return `👋 *AmWell Health Assistant*

*Quick Commands:*
🔍 Search products - Just type what you need
📦 *ORDERS* - Track your orders
📅 *APPOINTMENT* - Book a doctor
❓ *HELP* - Get assistance
📞 *CONTACT* - Reach support

Example: "I need amoxicillin"

How can I help you today?`;
    }
};

// ✅ Save conversation to database
const saveConversation = async (
    phoneNumber: string,
    userMessage: string,
    botResponse: string,
    intent: Intent,
    products: any[]
): Promise<void> => {
    try {
        const sessionId = phoneNumber; // Use phone number as session ID
        
        let conversation = await ChatConversation.findOne({ 
            sessionId,
            isActive: true 
        });
        
        if (!conversation) {
            conversation = new ChatConversation({
                userId: null, // WhatsApp users are guests unless they register
                sessionId,
                messages: []
            });
        }
        
        // Add user message
        const userMsg: IMessage = {
            sender: 'user',
            text: userMessage,
            intent: intent,
            timestamp: new Date()
        };
        conversation.messages.push(userMsg);
        
        // Add bot message with products
        const productIds = products.map(p => 
            typeof p._id === 'string' ? new mongoose.Types.ObjectId(p._id) : p._id
        );
        
        const botMsg: IMessage = {
            sender: 'bot',
            text: botResponse,
            products: productIds,
            intent: intent,
            timestamp: new Date()
        };
        conversation.messages.push(botMsg);
        
        await conversation.save();
        // console.log(`✅ Conversation saved for ${phoneNumber}`);
    } catch (error) {
        console.error('❌ Error saving conversation:', error);
    }
};

// ✅ Handle ORDER command
const handleOrderCommand = async (phoneNumber: string, orderText: string): Promise<string> => {
    try {
        // Extract product number from "ORDER 1", "order 2", etc.
        const match = orderText.match(/order\s+(\d+)/i);
        
        if (!match) {
            return `❌ *Invalid Format*

*Correct Usage:*
ORDER <number>

*Example:* ORDER 1

Please try again!`;
        }
        
        const productIndex = parseInt(match[1]) - 1;
        
        // Get last bot message with products
        const conversation = await ChatConversation.findOne({ 
            sessionId: phoneNumber 
        });
        
        if (!conversation) {
            return `❌ *No Recent Search*

Please search for a product first, then use the ORDER command.

*Example:*
1. Type: "I need paracetamol"
2. Then: "ORDER 1"`;
        }
        
        const lastBotMessage = conversation.messages
            .filter(m => m.sender === 'bot' && m.products && m.products.length > 0)
            .pop();
        
        if (!lastBotMessage || !lastBotMessage.products || lastBotMessage.products.length === 0) {
            return `❌ *No Products Found*

Please search for a product first.

*Try:* "I need amoxicillin"`;
        }
        
        // Fetch product details
        const products = await Product.find({
            _id: { $in: lastBotMessage.products }
        }).lean();
        
        if (productIndex < 0 || productIndex >= products.length) {
            return `❌ *Invalid Product Number*

Please choose between 1 and ${products.length}

Reply with: ORDER <number>`;
        }
        
        const selectedProduct = products[productIndex];
        
        // Generate order link
        const orderLink = `${APP_URL}/checkout?product=${selectedProduct._id}&phone=${phoneNumber}&source=whatsapp`;
        
        return `✅ *Order Initiated!*

*Product:* ${selectedProduct.name}
*Price:* ₦${selectedProduct.price.toLocaleString()}
*Brand:* ${selectedProduct.manufacturerName}

*Complete Your Order:*
🔗 ${orderLink}

*Or Call Us:*
📞 ${SUPPORT_PHONE}

*Delivery Info:*
🚚 24-48 hours delivery
💳 Pay on delivery available
📦 Free delivery over ₦5,000

*Order ID:* ORD-${Date.now()}

Thank you for choosing AmWell! 💙`;
        
    } catch (error) {
        console.error('❌ Error handling order:', error);
        return `❌ *Error Processing Order*

Please try again or contact support:
📞 ${SUPPORT_PHONE}`;
    }
};

// ✅ Handle HELP command
const handleHelpCommand = (): string => {
    return `❓ *AmWell Help Center*

*Available Commands:*

🔍 *Search Products*
Just type what you need
Example: "I need paracetamol"

🛒 *Order*
ORDER <number>
Example: ORDER 1

📦 *Track Orders*
Reply: ORDERS

📅 *Book Appointment*
Reply: APPOINTMENT

📞 *Contact Support*
Phone: ${SUPPORT_PHONE}
Email: support@amwell.com

🌐 *Visit Website*
${APP_URL}

*Tips:*
- Search by product name, brand, or category
- Orders are delivered in 24-48 hours
- We accept all payment methods

Need more help? Just ask! 😊`;
};

// ✅ Handle ORDERS command
const handleOrdersCommand = async (phoneNumber: string): Promise<string> => {
    return `📦 *Track Your Orders*

To track your orders:

1. Visit: ${APP_URL}/orders
2. Enter your phone: ${phoneNumber}
3. View all order details

Or call us:
📞 ${SUPPORT_PHONE}

*Need Help?*
Reply *HELP* anytime!`;
};

// ============================================
// WEBHOOK HANDLERS
// ============================================

// ✅ Verify webhook (required by Meta)
export const verifyWebhook = (req: Request, res: Response): void => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    // console.log('🔍 Webhook verification attempt:', { mode, token: token?.substring(0, 10) + '...' });

    if (mode === 'subscribe' && token === WEBHOOK_VERIFY_TOKEN) {
        // console.log('✅ Webhook verified successfully');
        res.status(200).send(challenge);
    } else {
        console.error('❌ Webhook verification failed');
        res.sendStatus(403);
    }
};

// ✅ Verify Meta signature
const verifySignature = (payload: string, signature: string): boolean => {
    try {
        if (!META_APP_SECRET) {
            console.error('❌ META_APP_SECRET not configured');
            return false;
        }

        const expectedSignature = 'sha256=' + 
            crypto
                .createHmac('sha256', META_APP_SECRET)
                .update(payload)
                .digest('hex');
        
        const isValid = crypto.timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(expectedSignature)
        );

        // console.log('🔐 Signature verification:', isValid ? '✅ Valid' : '❌ Invalid');
        return isValid;
    } catch (error) {
        console.error('❌ Signature verification error:', error);
        return false;
    }
};

// ✅ Handle incoming messages
export const handleMetaWebhook = async (req: Request, res: Response): Promise<void> => {
    try {
        const body = req.body;

        // console.log('📨 Received webhook:', JSON.stringify(body, null, 2));

        // Verify webhook signature for security
        const signature = req.headers['x-hub-signature-256'] as string;
        
        if (signature) {
            const rawBody = JSON.stringify(body);
            const isValid = verifySignature(rawBody, signature);
            
            if (!isValid) {
                console.error('❌ Invalid signature - potential security threat');
                res.sendStatus(403);
                return;
            }
        }

        // Check if it's a WhatsApp message
        if (body.object === 'whatsapp_business_account') {
            const entry = body.entry?.[0];
            const changes = entry?.changes?.[0];
            const value = changes?.value;
            const messages = value?.messages;

            if (messages && messages[0]) {
                const message = messages[0];
                const from = message.from; // Phone number
                const messageBody = message.text?.body;
                const messageType = message.type;
                const messageId = message.id;

                // console.log(`📱 WhatsApp message received:`);
                // console.log(`   From: ${from}`);
                // console.log(`   Type: ${messageType}`);
                // console.log(`   Body: ${messageBody}`);
                // console.log(`   ID: ${messageId}`);

                // Only process text messages
                if (messageType !== 'text') {
                    // console.log(`⚠️ Unsupported message type: ${messageType}`);
                    res.sendStatus(200);
                    return;
                }

                let responseText = '';

                // Check for special commands
                const lowerMessage = messageBody.toLowerCase().trim();

                if (lowerMessage === 'help') {
                    responseText = handleHelpCommand();
                } else if (lowerMessage === 'orders') {
                    responseText = await handleOrdersCommand(from);
                } else if (lowerMessage.startsWith('order')) {
                    responseText = await handleOrderCommand(from, lowerMessage);
                } else {
                    // Regular message processing
                    const intent = detectIntent(messageBody);
                    let products: any[] = [];
                    
                    if (intent === 'buy') {
                        const query = extractProductKeywords(messageBody);
                        products = await searchProducts(query);
                    }

                    responseText = generateWhatsAppResponse(intent, products, messageBody);

                    // Save conversation
                    await saveConversation(from, messageBody, responseText, intent, products);
                }

                // Send response back via Meta API
                await sendMetaWhatsAppMessage(from, responseText);

                // console.log(`✅ Response sent to ${from}`);
            }

            // Check for message status updates
            const statuses = value?.statuses;
            if (statuses && statuses[0]) {
                const status = statuses[0];
                // console.log(`📊 Message status update:`, status);
                // You can track delivery, read receipts, etc.

            }
        }

        // Always respond with 200 to acknowledge receipt
        res.sendStatus(200);
        
    } catch (error: any) {
        console.error('❌ Meta webhook error:', error);
        console.error('Stack trace:', error.stack);
        // Still return 200 to prevent Meta from disabling the webhook
        res.sendStatus(200);
    }
};

// ============================================
// MESSAGE SENDING FUNCTIONS
// ============================================

// ✅ Send text message via Meta API
const sendMetaWhatsAppMessage = async (to: string, message: string): Promise<any> => {
    try {
        if (!META_ACCESS_TOKEN || !PHONE_NUMBER_ID) {
            throw new Error('Meta WhatsApp credentials not configured');
        }

        const url = `https://graph.facebook.com/${META_API_VERSION}/${PHONE_NUMBER_ID}/messages`;
        
        const response = await axios.post(
            url,
            {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: to,
                type: 'text',
                text: { 
                    preview_url: true, // Enable URL previews
                    body: message 
                }
            },
            {
                headers: {
                    'Authorization': `Bearer ${META_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        // console.log('✅ Meta message sent successfully:', response.data);
        return response.data;
    } catch (error: any) {
        console.error('❌ Meta send error:', error.response?.data || error.message);
        throw error;
    }
};

// ✅ Send message with image
export const sendMetaWhatsAppImage = async (
    to: string, 
    imageUrl: string, 
    caption: string
): Promise<void> => {
    try {
        const url = `https://graph.facebook.com/${META_API_VERSION}/${PHONE_NUMBER_ID}/messages`;
        
        await axios.post(
            url,
            {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: to,
                type: 'image',
                image: {
                    link: imageUrl,
                    caption: caption
                }
            },
            {
                headers: {
                    'Authorization': `Bearer ${META_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        // console.log('✅ Image sent successfully');
    } catch (error: any) {
        console.error('❌ Error sending image:', error.response?.data || error.message);
        throw error;
    }
};

// ✅ Send interactive buttons (Meta WhatsApp feature!)
export const sendMetaInteractiveButtons = async (
    to: string, 
    bodyText: string, 
    buttons: Array<{ id: string; title: string }>
): Promise<void> => {
    try {
        const url = `https://graph.facebook.com/${META_API_VERSION}/${PHONE_NUMBER_ID}/messages`;
        
        await axios.post(
            url,
            {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: to,
                type: 'interactive',
                interactive: {
                    type: 'button',
                    body: { text: bodyText },
                    action: {
                        buttons: buttons.slice(0, 3).map(btn => ({ // Max 3 buttons
                            type: 'reply',
                            reply: {
                                id: btn.id,
                                title: btn.title.substring(0, 20) // Max 20 chars
                            }
                        }))
                    }
                }
            },
            {
                headers: {
                    'Authorization': `Bearer ${META_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        // console.log('✅ Interactive buttons sent successfully');
    } catch (error: any) {
        console.error('❌ Error sending buttons:', error.response?.data || error.message);
        throw error;
    }
};

// ✅ Send list message (for product catalogs)
export const sendMetaListMessage = async (
    to: string,
    headerText: string,
    bodyText: string,
    sections: Array<{
        title: string;
        rows: Array<{ id: string; title: string; description: string }>
    }>
): Promise<void> => {
    try {
        const url = `https://graph.facebook.com/${META_API_VERSION}/${PHONE_NUMBER_ID}/messages`;
        
        await axios.post(
            url,
            {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: to,
                type: 'interactive',
                interactive: {
                    type: 'list',
                    header: {
                        type: 'text',
                        text: headerText
                    },
                    body: { text: bodyText },
                    action: {
                        button: 'View Products',
                        sections: sections
                    }
                }
            },
            {
                headers: {
                    'Authorization': `Bearer ${META_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        // console.log('✅ List message sent successfully');
    } catch (error: any) {
        console.error('❌ Error sending list:', error.response?.data || error.message);
        throw error;
    }
};

// ============================================
// PROACTIVE MESSAGING (For order updates, etc.)
// ============================================

// ✅ Send order confirmation
export const sendOrderConfirmation = async (
    phoneNumber: string,
    orderDetails: {
        orderId: string;
        total: number;
        items: Array<{ name: string; quantity: number; price: number }>;
        address: string;
        estimatedDelivery: string;
    }
): Promise<void> => {
    const message = `🎉 *Order Confirmed!*

*Order ID:* #${orderDetails.orderId}
*Total Amount:* ₦${orderDetails.total.toLocaleString()}

*Items Ordered:*
${orderDetails.items.map((item, i) => 
    `${i + 1}. ${item.name}\n   Qty: ${item.quantity} × ₦${item.price.toLocaleString()}`
).join('\n')}

*Delivery Address:*
${orderDetails.address}

*Estimated Delivery:* ${orderDetails.estimatedDelivery}

*Track Order:*
${APP_URL}/orders/${orderDetails.orderId}

*Need Help?*
📞 ${SUPPORT_PHONE}
Reply *HELP* anytime

Thank you for choosing AmWell! 💙`;

    await sendMetaWhatsAppMessage(phoneNumber, message);
};

// ✅ Send order status update
export const sendOrderStatusUpdate = async (
    phoneNumber: string,
    orderId: string,
    status: 'processing' | 'shipped' | 'out_for_delivery' | 'delivered' | 'cancelled',
    trackingInfo?: string
): Promise<void> => {
    let message = '';
    
    switch (status) {
        case 'processing':
            message = `⏳ *Order Being Processed*

*Order ID:* #${orderId}

Your order is being carefully prepared by our pharmacy team.

We'll notify you when it ships! 📦`;
            break;
            
        case 'shipped':
            message = `🚚 *Order Shipped!*

*Order ID:* #${orderId}
${trackingInfo ? `*Tracking:* ${trackingInfo}` : ''}

Your order is on its way to you!

*Estimated Delivery:* 24-48 hours

*Track Order:*
${APP_URL}/orders/${orderId}`;
            break;
            
        case 'out_for_delivery':
            message = `🏃 *Out for Delivery!*

*Order ID:* #${orderId}

Your order will arrive today!
Please ensure someone is available to receive it.

*Track in Real-Time:*
${APP_URL}/orders/${orderId}`;
            break;
            
        case 'delivered':
            message = `✅ *Order Delivered!*

*Order ID:* #${orderId}

Thank you for shopping with AmWell! 💙

*Rate Your Experience:*
${APP_URL}/rate/${orderId}

*Need to Reorder?*
Just reply with the product name!`;
            break;
            
        case 'cancelled':
            message = `❌ *Order Cancelled*

*Order ID:* #${orderId}

Your order has been cancelled as requested.

If this was a mistake or you need help:
📞 ${SUPPORT_PHONE}
Reply *HELP*`;
            break;
            
        default:
            message = `📋 *Order Update*

*Order ID:* #${orderId}
*Status:* ${status}

*Track Order:*
${APP_URL}/orders/${orderId}`;
    }
    
    await sendMetaWhatsAppMessage(phoneNumber, message);
};

// ✅ Send promotional message (use sparingly - WhatsApp has strict policies!)
export const sendPromotionalMessage = async (
    phoneNumber: string,
    promotion: {
        title: string;
        description: string;
        code: string;
        validUntil: string;
    }
): Promise<void> => {
    const message = `🎁 *Special Offer for You!*

*${promotion.title}*

${promotion.description}

*Promo Code:* ${promotion.code}
*Valid Until:* ${promotion.validUntil}

*Shop Now:*
${APP_URL}/products

*Reply STOP to unsubscribe from promotions*`;

    await sendMetaWhatsAppMessage(phoneNumber, message);
};