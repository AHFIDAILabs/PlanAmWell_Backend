import { Schema, model, Document, Types } from "mongoose";

export interface IFamilyMember extends Document {
  userId: Types.ObjectId;
  name: string;
  relationship: "Spouse" | "Child" | "Parent" | "Sibling" | "Other";
  gender?: "Male" | "Female" | "Other";
  dateOfBirth?: Date;
  bloodGroup?: string;
  allergies?: string;
  notes?: string;
}

const FamilyMemberSchema = new Schema<IFamilyMember>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    name: { type: String, required: true, trim: true },
    relationship: {
      type: String,
      enum: ["Spouse", "Child", "Parent", "Sibling", "Other"],
      required: true,
    },
    gender: { type: String, enum: ["Male", "Female", "Other"] },
    dateOfBirth: { type: Date },
    bloodGroup: { type: String, trim: true },
    allergies: { type: String, trim: true },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

export const FamilyMember = model<IFamilyMember>("FamilyMember", FamilyMemberSchema);
