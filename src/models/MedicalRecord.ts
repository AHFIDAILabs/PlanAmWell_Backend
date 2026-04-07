// models/MedicalRecord.ts
import mongoose, { Schema, Document, Types } from "mongoose";

// ─── Sub-schemas ─────────────────────────────────────────────────────────────

export interface IPrescription {
  drug: string;
  dosage: string; // e.g. "500mg"
  form: string; // e.g. "tablet", "syrup", "injection"
  frequency: string; // e.g. "twice daily"
  duration: string; // e.g. "7 days"
  instructions?: string; // e.g. "take after meals"
}

export interface IDiagnosisEntry {
  code?: string; // ICD-10 code (optional — not a blocker)
  description: string; // e.g. "Type 2 Diabetes Mellitus"
  severity?: "mild" | "moderate" | "severe";
}

export interface IVitalSigns {
  bloodPressure?: string; // e.g. "120/80 mmHg"
  pulse?: string; // e.g. "72 bpm"
  temperature?: string; // e.g. "37.2°C"
  weight?: string; // e.g. "70 kg"
  height?: string; // e.g. "175 cm"
  bmi?: string;
  oxygenSaturation?: string; // e.g. "98%"
}

export interface ILabTest {
  name: string;
  result?: string;
  unit?: string;
  referenceRange?: string;
  status?: "normal" | "abnormal" | "pending";
}

export interface IAttachment {
  url: string;
  name: string;
  type: "image" | "pdf" | "other";
}

export interface IConsultationNote {
  _id: Types.ObjectId;
  appointmentId: Types.ObjectId;
  doctorId: Types.ObjectId;
  doctorName: string;
  doctorSpecialization: string;
  doctorLicenseNumber: string;
  consultationDate: Date;
  chiefComplaint: string;
  vitalSigns?: IVitalSigns;
  diagnosis: IDiagnosisEntry[];
  prescriptions: IPrescription[];
  labTests: ILabTest[];
  followUpInstructions?: string;
  followUpDate?: Date;
  privateNotes?: string; // NEVER shared with other doctors or patient
  attachments: IAttachment[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IAccessLogEntry {
  doctorId: Types.ObjectId;
  doctorName: string;
  appointmentId: Types.ObjectId;
  accessedAt: Date;
}

export interface IMedicalRecord extends Document {
  patientId: Types.ObjectId;
  patientSnapshot: {
    name: string;
    email?: string;
    phone?: string;
    gender?: string;
    dateOfBirth?: string;
    bloodGroup?: string; // filled by first doctor — not a blocker
    allergies?: string[]; // filled by first doctor — not a blocker
    homeAddress?: string;
  };
  consultationNotes: IConsultationNote[];
  accessLog: IAccessLogEntry[];
  createdAt: Date;
  updatedAt: Date;
}

// ─── Schemas

const PrescriptionSchema = new Schema<IPrescription>(
  {
    drug: { type: String, required: true },
    dosage: { type: String, required: true },
    form: { type: String, required: true },
    frequency: { type: String, required: true },
    duration: { type: String, required: true },
    instructions: String,
  },
  { _id: false },
);

const DiagnosisSchema = new Schema<IDiagnosisEntry>(
  {
    code: String,
    description: { type: String, required: true },
    severity: { type: String, enum: ["mild", "moderate", "severe"] },
  },
  { _id: false },
);

const VitalSignsSchema = new Schema<IVitalSigns>(
  {
    bloodPressure: String,
    pulse: String,
    temperature: String,
    weight: String,
    height: String,
    bmi: String,
    oxygenSaturation: String,
  },
  { _id: false },
);

const LabTestSchema = new Schema<ILabTest>(
  {
    name: { type: String, required: true },
    result: String,
    unit: String,
    referenceRange: String,
    status: { type: String, enum: ["normal", "abnormal", "pending"] },
  },
  { _id: false },
);

const AttachmentSchema = new Schema<IAttachment>(
  {
    url: { type: String, required: true },
    name: { type: String, required: true },
    type: { type: String, enum: ["image", "pdf", "other"], default: "other" },
  },
  { _id: false },
);

const ConsultationNoteSchema = new Schema<IConsultationNote>(
  {
    appointmentId: {
      type: Schema.Types.ObjectId,
      ref: "Appointment",
      required: true,
    },
    doctorId: { type: Schema.Types.ObjectId, ref: "Doctor", required: true },
    doctorName: { type: String, required: true },
    doctorSpecialization: { type: String, required: true },
    doctorLicenseNumber: { type: String, required: true },
    consultationDate: { type: Date, required: true },
    chiefComplaint: { type: String, required: true },
    vitalSigns: VitalSignsSchema,
    diagnosis: { type: [DiagnosisSchema], default: [] },
    prescriptions: { type: [PrescriptionSchema], default: [] },
    labTests: { type: [LabTestSchema], default: [] },
    followUpInstructions: String,
    followUpDate: Date,
    privateNotes: String, // never projected out when shared
    attachments: { type: [AttachmentSchema], default: [] },
  },
  { timestamps: true },
);

const AccessLogSchema = new Schema<IAccessLogEntry>(
  {
    doctorId: { type: Schema.Types.ObjectId, ref: "Doctor", required: true },
    doctorName: { type: String, required: true },
    appointmentId: {
      type: Schema.Types.ObjectId,
      ref: "Appointment",
      required: true,
    },
    accessedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const MedicalRecordSchema = new Schema<IMedicalRecord>(
  {
    patientId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,

    },
    patientSnapshot: {
      name: { type: String, required: true },
      email: String,
      phone: String,
      gender: String,
      dateOfBirth: String,
      bloodGroup: String,
      allergies: { type: [String], default: [] },
      homeAddress: String,
    },
    consultationNotes: { type: [ConsultationNoteSchema], default: [] },
    accessLog: { type: [AccessLogSchema], default: [] },
  },
  { timestamps: true },
);

MedicalRecordSchema.index({ patientId: 1 });
MedicalRecordSchema.index({ "consultationNotes.doctorId": 1 });
MedicalRecordSchema.index({ "consultationNotes.appointmentId": 1 });

export const MedicalRecord = mongoose.model<IMedicalRecord>(
  "MedicalRecord",
  MedicalRecordSchema,
);
