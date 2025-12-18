import mongoose, { Schema, Document } from 'mongoose';

export interface IAudio {
  cloudinaryId: string;
  cloudinaryUrl: string;
}

export interface IMessage {
    sender: 'user' | 'bot';
    text: string;
    products?: mongoose.Types.ObjectId[];
    intent?: 'buy' | 'info' | 'appointment' | 'general' | 'greeting' | 'health';
    audio?: IAudio; // Optional audio info for voice messages
    timestamp: Date;
}

export interface IChatConversation extends Document {
    userId: mongoose.Types.ObjectId | null; // Allow null for guest users
    sessionId: string;
    messages: IMessage[];
    isActive: boolean;
    lastActivity: Date;
    createdAt: Date;
    updatedAt: Date;
}

const messageSchema = new Schema<IMessage>({
    sender: {
        type: String,
        enum: ['user', 'bot'],
        required: true
    },
    text: {
        type: String,
        required: true
    },
    products: [{
        type: Schema.Types.ObjectId,
        ref: 'Product'
    }],
    intent: {
        type: String,
        enum: ['buy', 'info', 'appointment', 'general', 'greeting', 'health'],
        default: 'general'
    },
    audio: {
        cloudinaryId: { type: String },
        cloudinaryUrl: { type: String }
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
});

const chatConversationSchema = new Schema<IChatConversation>({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: false,
        default: null,
        index: true
    },
    sessionId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    messages: [messageSchema],
    isActive: {
        type: Boolean,
        default: true
    },
    lastActivity: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Auto-update lastActivity on save
chatConversationSchema.pre('save', function(next) {
    this.lastActivity = new Date();
    next();
});

// Index for efficient queries
chatConversationSchema.index({ userId: 1, isActive: 1 });

export const ChatConversation = mongoose.model<IChatConversation>('ChatConversation', chatConversationSchema);
