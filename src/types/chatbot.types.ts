import { IProduct } from '../models/product';

export type Intent =
  | 'health'
  | 'buy'
  | 'info'
  | 'appointment'
  | 'general'
  | 'greeting';


export interface ChatbotRequest {
    message: string;
    userId?: string; // Optional for guest users
    sessionId?: string; // Optional, will be generated if not provided
}

// Define a lean product type for API responses
export interface ProductResponse {
    _id: any;
    partnerId: string;
    partnerProductId: string;
    drugId: string;
    name: string;
    sku: string;
    imageUrl: string;
    categoryName: string;
    prescriptionRequired: boolean;
    manufacturerName: string;
    price: number;
    expired: Date | null;
    stockQuantity: number;
    status: string;
}

export interface ChatbotResponse {
    success: boolean;
    response: string;
    intent: Intent;
    products: ProductResponse[]; 
    sessionId: string;
}

export interface ConversationHistoryResponse {
    success: boolean;
    conversation: any;
}

export interface SearchResult {
    intent: Intent;
    productQuery: string;
}