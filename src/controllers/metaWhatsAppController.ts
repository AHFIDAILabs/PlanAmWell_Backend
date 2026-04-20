// controllers/metaWhatsAppController.ts
import { Request, Response } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { Product } from '../models/product';
import { ChatConversation, IMessage } from '../models/ChatConversation';
import { Intent } from '../types/chatbot.types';

// Environment variables
const WEBHOOK_VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN;
const META_ACCESS_TOKEN = process.env.META_WHATSAPP_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;
const META_APP_SECRET = process.env.META_APP_SECRET;
const META_API_VERSION = 'v21.0';
const APP_URL = process.env.APP_URL;
const DEEP_LINK_SCHEME = process.env.DEEP_LINK_SCHEME || 'planamwell://';
const APP_DOMAIN = process.env.APP_DOMAIN || 'planamwell.com';
const SUPPORT_PHONE = process.env.SUPPORT_PHONE || '+2349168767784';

// ============================================
// HELPER FUNCTIONS
// ============================================

// ✅ Generate deep link (opens app if installed, web otherwise)
const generateDeepLink = (path: string, params?: Record<string, string>): string => {
  const queryString = params
    ? '?' + new URLSearchParams(params).toString()
    : '';

  const cleanPath = path.replace(/^\//, ''); // remove leading slash

  // Primary: custom scheme (works immediately, no server needed)
  // Format: planamwell://appointments?type=std-screening
  return `${DEEP_LINK_SCHEME}${cleanPath}${queryString}`;
};
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
        'find',
        'information about',
        'info about',
        'tell me about',
        'what is',
        'what are'
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
    
    return cleaned;
};

// ✅ Enhanced intent detection
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
        // Check if it's asking for information rather than buying
        const infoIndicators = ['what is', 'what are', 'tell me', 'information', 'explain', 'about'];
        const hasInfoIntent = infoIndicators.some(indicator => lowerMessage.includes(indicator));
        
        if (!hasInfoIntent) {
            return 'buy';
        }
    }
    
    // Appointment intent
    const appointmentKeywords = ['appointment', 'book', 'schedule', 'doctor', 'consultation', 'see a doctor'];
    if (appointmentKeywords.some(keyword => lowerMessage.includes(keyword))) {
        return 'appointment';
    }
    
    // Health info intent - EXPANDED
    const healthInfoKeywords = [
        'what is', 'what are', 'how', 'why', 'tell me', 'explain', 'information', 'about',
        'std', 'sti', 'sexually transmitted', 'reproductive health', 'sexual health',
        'contraceptive', 'birth control', 'pregnancy', 'menstrual', 'fertility',
        'infection', 'disease', 'symptom', 'treatment', 'prevention', 'cure',
        'hiv', 'aids', 'gonorrhea', 'syphilis', 'chlamydia', 'herpes', 'hpv'
    ];
    if (healthInfoKeywords.some(keyword => lowerMessage.includes(keyword))) {
        return 'info';
    }
    
    return 'general';
};

// ✅ NEW: Provide health information
const getHealthInformation = (query: string): string => {
    const lowerQuery = query.toLowerCase();
    
    // STD/STI Information
    if (lowerQuery.includes('std') || lowerQuery.includes('sti') || 
        lowerQuery.includes('sexually transmitted')) {
        return `🏥 *Sexually Transmitted Diseases (STDs)*

*Common STDs include:*
• Chlamydia
• Gonorrhea  
• Syphilis
• HIV/AIDS
• Herpes (HSV)
• HPV (Human Papillomavirus)
• Trichomoniasis

*Prevention:*
✓ Use condoms consistently
✓ Get regular screenings
✓ Limit sexual partners
✓ Get vaccinated (HPV, Hepatitis B)

*Symptoms to watch for:*
• Unusual discharge
• Pain during urination
• Sores or bumps
• Itching or irritation

⚠️ *Important:* Many STDs have no symptoms. Regular testing is crucial!

*Get Tested or Consult:*
📱 ${generateDeepLink('/appointments', { type: 'std-screening' })}

*Need Treatment?*
Search for medications: Reply "antibiotics" or specific medicine names

*Emergency?* Call ${SUPPORT_PHONE}`;
    }
    
    // HIV/AIDS Information
    if (lowerQuery.includes('hiv') || lowerQuery.includes('aids')) {
        return `🏥 *HIV/AIDS Information*

*What is HIV?*
Human Immunodeficiency Virus attacks the immune system. Without treatment, it can lead to AIDS.

*Prevention:*
✓ Use condoms correctly every time
✓ PrEP (Pre-Exposure Prophylaxis) for high-risk individuals
✓ Never share needles
✓ Get tested regularly

*Treatment:*
Modern antiretroviral therapy (ART) allows people with HIV to live long, healthy lives.

*Testing:*
• Get tested every 3-6 months if sexually active
• Results confidential
• Early detection = better outcomes

*Book HIV Test/Consultation:*
📱 ${generateDeepLink('/appointments', { type: 'hiv-testing' })}

*PrEP/PEP Medications:*
📱 ${generateDeepLink('/products', { category: 'hiv-prevention' })}

*24/7 Support:* ${SUPPORT_PHONE}`;
    }
    
    // Reproductive Health
    if (lowerQuery.includes('reproductive') || lowerQuery.includes('sexual health')) {
        return `🏥 *Reproductive Health*

*We can help with:*

*Contraception:*
• Birth control pills
• Condoms
• Emergency contraception
• IUDs & implants (consultation required)

*Fertility:*
• Ovulation tracking
• Fertility supplements
• Prenatal vitamins

*Menstrual Health:*
• Period pain relief
• Irregular cycles
• PMS management

*Infections:*
• UTI treatment
• Yeast infections
• STI screening & treatment

*Book Consultation:*
📱 ${generateDeepLink('/appointments', { specialty: 'reproductive-health' })}

*Shop Products:*
📱 ${generateDeepLink('/products', { category: 'reproductive-health' })}

*Questions?* Reply with specific concern or call ${SUPPORT_PHONE}`;
    }
    
    // Birth Control/Contraceptives
    if (lowerQuery.includes('birth control') || lowerQuery.includes('contraceptive') || 
        lowerQuery.includes('emergency contraception')) {
        return `💊 *Birth Control & Contraceptives*

*Available Options:*

*Hormonal Methods:*
• Birth control pills
• Patches
• Injections
• Implants (requires consultation)

*Barrier Methods:*
• Condoms (male & female)
• Diaphragms

*Emergency Contraception:*
• Morning-after pill (Plan B)
• Effective up to 72 hours after intercourse

*Permanent Methods:*
• Consultation required

*Shop Contraceptives:*
📱 ${generateDeepLink('/products', { category: 'contraceptives' })}

*Consult a Doctor:*
📱 ${generateDeepLink('/appointments', { type: 'contraception-consultation' })}

*Need emergency contraception?*
Reply: "emergency pill" or "plan b"`;
    }
    
    // Generic health info
    return `🏥 *Health Information*

I can provide information about:

*Sexual Health:*
• STDs/STIs
• HIV/AIDS  
• Contraception
• Reproductive health

*Common Conditions:*
• Infections
• Pain management
• Skin conditions
• Digestive health

*Medications:*
• Antibiotics
• Pain relievers
• Supplements
• Prescriptions

*What would you like to know about?*

Or get personalized advice:
📱 ${generateDeepLink('/appointments')}

*Call us:* ${SUPPORT_PHONE}`;
};

// ✅ Search products
const searchProducts = async (query: string, limit: number = 5): Promise<any[]> => {
    try {
        if (!query || query.trim() === '') {
            return [];
        }

        const cleanedQuery = query
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        
        const searchTerms = cleanedQuery.split(' ').filter(term => term.length > 2);
        
        if (searchTerms.length === 0) {
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
            return `👋 *Welcome to AskAmWell Health!*

I'm your AI health assistant. I can help you:

💊 *Find medicines & health products*
🏥 *Get health information (STDs, contraception, etc.)*
📅 *Book doctor appointments*
🛒 *Order directly via WhatsApp*
📍 *Track your orders*

*Quick Commands:*
- Type a product name to search
- Ask health questions (e.g., "What are STDs?")
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
                response += `📱 Or order via app:\n${generateDeepLink('/products')}`;
                
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
- "Emergency contraception"

I'll find the best matches for you! 💊`;
                }
                return `😕 *No products found for "${query}"*

*Suggestions:*
✓ Check spelling
✓ Try generic names (e.g., "Paracetamol" not "Panadol")
✓ Search by category (e.g., "antibiotics", "pain relief")
✓ Try brand names

*Browse all products:*
📱 ${generateDeepLink('/products')}

*Need Help?*
Reply *HELP* or call ${SUPPORT_PHONE}`;
            }
        
        case 'appointment':
            return `📅 *Book a Doctor Appointment*

*Quick Booking:*
📱 ${generateDeepLink('/appointments')}

*Or call us:*
📞 ${SUPPORT_PHONE}

*Available Specialties:*
- General Practitioner
- Sexual Health / STD Screening
- Reproductive Health
- Specialist Consultation
- Emergency Care

*To continue here, tell me:*
• Type of doctor needed
• Preferred date/time
• Reason for visit

What works best for you?`;
        
        case 'info':
            const query = extractProductKeywords(userMessage);
            return getHealthInformation(query);
        
        default:
            return `👋 *AskAmWell Health Assistant*

*Quick Commands:*
🔍 Search products - Type what you need
🏥 *HEALTH INFO* - Ask health questions
📦 *ORDERS* - Track your orders
📅 *APPOINTMENT* - Book a doctor
❓ *HELP* - Get assistance
📞 *CONTACT* - Reach support

*Examples:*
• "I need amoxicillin"
• "What are STDs?"
• "Birth control options"
• "Book STD screening"

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
        const sessionId = phoneNumber;
        
        let conversation = await ChatConversation.findOne({ 
            sessionId,
            isActive: true 
        });
        
        if (!conversation) {
            conversation = new ChatConversation({
                userId: null,
                sessionId,
                messages: []
            });
        }
        
        const userMsg: IMessage = {
            sender: 'user',
            text: userMessage,
            intent: intent,
            timestamp: new Date()
        };
        conversation.messages.push(userMsg);
        
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
    } catch (error) {
        console.error('❌ Error saving conversation:', error);
    }
};

// ✅ Handle ORDER command
const handleOrderCommand = async (phoneNumber: string, orderText: string): Promise<string> => {
    try {
        const match = orderText.match(/order\s+(\d+)/i);
        
        if (!match) {
            return `❌ *Invalid Format*

*Correct Usage:*
ORDER <number>

*Example:* ORDER 1

Please try again!`;
        }
        
        const productIndex = parseInt(match[1]) - 1;
        
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
        
        const products = await Product.find({
            _id: { $in: lastBotMessage.products }
        }).lean();
        
        if (productIndex < 0 || productIndex >= products.length) {
            return `❌ *Invalid Product Number*

Please choose between 1 and ${products.length}

Reply with: ORDER <number>`;
        }
        
        const selectedProduct = products[productIndex];
        
        const orderLink = generateDeepLink('/checkout', {
            product: selectedProduct._id.toString(),
            phone: phoneNumber,
            source: 'whatsapp'
        });
        
        return `✅ *Order Initiated!*

*Product:* ${selectedProduct.name}
*Price:* ₦${selectedProduct.price.toLocaleString()}
*Brand:* ${selectedProduct.manufacturerName}

*Complete Your Order:*
📱 ${orderLink}

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
    return `❓ *AskAmWell Help Center*

*Available Commands:*

🔍 *Search Products*
Just type what you need
Example: "I need paracetamol"

🏥 *Health Information*
Ask about conditions, STDs, etc.
Example: "What are STDs?"

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

📱 *Open App*
${generateDeepLink('/home')}

*Tips:*
- Search by product name, brand, or category
- Ask health questions anytime
- Orders delivered in 24-48 hours
- All payment methods accepted

Need more help? Just ask! 😊`;
};

// ✅ Handle ORDERS command
const handleOrdersCommand = async (phoneNumber: string): Promise<string> => {
    const trackLink = generateDeepLink('/orders', { phone: phoneNumber });
    
    return `📦 *Track Your Orders*

*Open in App:*
📱 ${trackLink}

*Or call us:*
📞 ${SUPPORT_PHONE}

*Need Help?*
Reply *HELP* anytime!`;
};

// ============================================
// WEBHOOK HANDLERS
// ============================================

export const verifyWebhook = (req: Request, res: Response): void => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === WEBHOOK_VERIFY_TOKEN) {
        res.status(200).send(challenge);
    } else {
        console.error('❌ Webhook verification failed');
        res.sendStatus(403);
    }
};

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

        return isValid;
    } catch (error) {
        console.error('❌ Signature verification error:', error);
        return false;
    }
};

export const handleMetaWebhook = async (req: Request, res: Response): Promise<void> => {
    try {
        const body = req.body;

        const signature = req.headers['x-hub-signature-256'] as string;
        const rawBody = JSON.stringify(body);

        // Require signature verification when META_APP_SECRET is configured
        if (META_APP_SECRET) {
            if (!signature) {
                console.error('❌ Missing webhook signature - request rejected');
                res.sendStatus(403);
                return;
            }
            if (!verifySignature(rawBody, signature)) {
                console.error('❌ Invalid signature - potential security threat');
                res.sendStatus(403);
                return;
            }
        }

        if (body.object === 'whatsapp_business_account') {
            const entry = body.entry?.[0];
            const changes = entry?.changes?.[0];
            const value = changes?.value;
            const messages = value?.messages;

            if (messages && messages[0]) {
                const message = messages[0];
                const from = message.from;
                const messageBody = message.text?.body;
                const messageType = message.type;

                if (messageType !== 'text') {
                    res.sendStatus(200);
                    return;
                }

                let responseText = '';

                const lowerMessage = messageBody.toLowerCase().trim();

                if (lowerMessage === 'help') {
                    responseText = handleHelpCommand();
                } else if (lowerMessage === 'orders') {
                    responseText = await handleOrdersCommand(from);
                } else if (lowerMessage.startsWith('order')) {
                    responseText = await handleOrderCommand(from, lowerMessage);
                } else {
                    const intent = detectIntent(messageBody);
                    let products: any[] = [];
                    
                    if (intent === 'buy') {
                        const query = extractProductKeywords(messageBody);
                        products = await searchProducts(query);
                    }

                    responseText = generateWhatsAppResponse(intent, products, messageBody);

                    await saveConversation(from, messageBody, responseText, intent, products);
                }

                await sendMetaWhatsAppMessage(from, responseText);
            }

            const statuses = value?.statuses;
            if (statuses && statuses[0]) {
                const status = statuses[0];
                // Track delivery status if needed
            }
        }

        res.sendStatus(200);
        
    } catch (error: any) {
        console.error('❌ Meta webhook error:', error);
        console.error('Stack trace:', error.stack);
        res.sendStatus(200);
    }
};

// ============================================
// MESSAGE SENDING FUNCTIONS
// ============================================

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
                    preview_url: true,
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

        return response.data;
    } catch (error: any) {
        console.error('❌ Meta send error:', error.response?.data || error.message);
        throw error;
    }
};

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
    } catch (error: any) {
        console.error('❌ Error sending image:', error.response?.data || error.message);
        throw error;
    }
};

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
                        buttons: buttons.slice(0, 3).map(btn => ({
                            type: 'reply',
                            reply: {
                                id: btn.id,
                                title: btn.title.substring(0, 20)
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
    } catch (error: any) {
        console.error('❌ Error sending buttons:', error.response?.data || error.message);
        throw error;
    }
};

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
    } catch (error: any) {
        console.error('❌ Error sending list:', error.response?.data || error.message);
        throw error;
    }
};

// ============================================
// PROACTIVE MESSAGING
// ============================================

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
    const trackLink = generateDeepLink('/orders', { orderId: orderDetails.orderId });
    
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
📱 ${trackLink}

*Need Help?*
📞 ${SUPPORT_PHONE}
Reply *HELP* anytime

Thank you for choosing AmWell! 💙`;

    await sendMetaWhatsAppMessage(phoneNumber, message);
};

export const sendOrderStatusUpdate = async (
    phoneNumber: string,
    orderId: string,
    status: 'processing' | 'shipped' | 'out_for_delivery' | 'delivered' | 'cancelled',
    trackingInfo?: string
): Promise<void> => {
    const trackLink = generateDeepLink('/orders', { orderId });
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
📱 ${trackLink}`;
            break;
            
        case 'out_for_delivery':
            message = `🏃 *Out for Delivery!*

*Order ID:* #${orderId}

Your order will arrive today!
Please ensure someone is available to receive it.

*Track in Real-Time:*
📱 ${trackLink}`;
            break;
            
        case 'delivered':
            message = `✅ *Order Delivered!*

*Order ID:* #${orderId}

Thank you for shopping with AmWell! 💙

*Rate Your Experience:*
📱 ${generateDeepLink('/rate', { orderId })}

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
📱 ${trackLink}`;
    }
    
    await sendMetaWhatsAppMessage(phoneNumber, message);
};

export const sendPromotionalMessage = async (
    phoneNumber: string,
    promotion: {
        title: string;
        description: string;
        code: string;
        validUntil: string;
    }
): Promise<void> => {
    const shopLink = generateDeepLink('/products', { promo: promotion.code });
    
    const message = `🎁 *Special Offer for You!*

*${promotion.title}*

${promotion.description}

*Promo Code:* ${promotion.code}
*Valid Until:* ${promotion.validUntil}

*Shop Now:*
📱 ${shopLink}

*Reply STOP to unsubscribe from promotions*`;

    await sendMetaWhatsAppMessage(phoneNumber, message);
};