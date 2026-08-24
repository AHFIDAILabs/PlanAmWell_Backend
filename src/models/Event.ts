import { Schema, model, Document, Types } from "mongoose";

export interface IEvent extends Document {
  title: string;
  description: string;
  category?: string;
  startsAt: Date;
  endsAt?: Date;
  location?: string;
  isVirtual: boolean;
  capacity?: number;
  createdBy: Types.ObjectId;
  isActive: boolean;
}

const EventSchema = new Schema<IEvent>(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    category: { type: String, trim: true },
    startsAt: { type: Date, required: true, index: true },
    endsAt: { type: Date },
    location: { type: String, trim: true },
    isVirtual: { type: Boolean, default: false },
    capacity: { type: Number, min: 1 },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Event = model<IEvent>("Event", EventSchema);
