// controllers/medicalRecordController.ts
import { Request, Response } from "express";
import asyncHandler from "../middleware/asyncHandler";
import mongoose from "mongoose";
import { MedicalRecord } from "../models/MedicalRecord";
import { AccessRequest } from "../models/AccessRequest";
import { Appointment } from "../models/appointment";
import { User } from "../models/user";
import { Doctor } from "../models/doctor";
import { NotificationService } from "../services/NotificationService";
import { emitAccessRequestUpdate } from "../index";
import PDFDocument from "pdfkit"

// ─── Helpers ─────────────────────────────────────────────────────────────────

const extractId = (field: any): string => {
  if (!field) return "";
  if (typeof field === "string") return field;
  if (typeof field === "object" && field._id) return String(field._id);
  return String(field);
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. CREATE OR UPDATE CONSULTATION NOTE (Doctor)
//    POST /api/v1/medical-records/note
// ─────────────────────────────────────────────────────────────────────────────
export const createOrUpdateNote = asyncHandler(
  async (req: Request, res: Response) => {
    const doctorId = req.auth?.id;
    const {
      appointmentId,
      chiefComplaint,
      vitalSigns,
      diagnosis,
      prescriptions,
      labTests,
      followUpInstructions,
      followUpDate,
      privateNotes,
      attachments,
      // optional patient record fields (filled by doctor)
      bloodGroup,
      allergies,
    } = req.body;

    if (!appointmentId || !chiefComplaint) {
      return res.status(400).json({
        success: false,
        message: "appointmentId and chiefComplaint are required.",
      });
    }

    // ── Validate appointment belongs to this doctor ───────────────────────────
    const appointment = await Appointment.findById(appointmentId)
      .populate("userId", "name email phone gender dateOfBirth homeAddress")
      .populate("doctorId", "firstName lastName specialization licenseNumber");

    if (!appointment) {
      return res.status(404).json({ success: false, message: "Appointment not found." });
    }

    if (extractId(appointment.doctorId) !== doctorId) {
      return res.status(403).json({ success: false, message: "You can only write notes for your own appointments." });
    }

    const doctor = appointment.doctorId as any;
    const patient = appointment.userId as any;

    const doctorName           = `Dr. ${doctor.lastName || doctor.firstName}`;
    const doctorSpecialization = doctor.specialization || "";
    const doctorLicenseNumber  = doctor.licenseNumber  || "";
    const patientId            = extractId(appointment.userId);

    // ── Get or create the patient's medical record ────────────────────────────
    let record = await MedicalRecord.findOne({ patientId });

    if (!record) {
      record = await MedicalRecord.create({
        patientId,
        patientSnapshot: {
          name:        patient?.name        || "Unknown",
          email:       patient?.email,
          phone:       patient?.phone,
          gender:      patient?.gender,
          dateOfBirth: patient?.dateOfBirth,
          homeAddress: patient?.homeAddress,
          bloodGroup:  bloodGroup  || undefined,
          allergies:   allergies   || [],
        },
        consultationNotes: [],
        accessLog: [],
      });
    } else {
      // Update blood group / allergies if doctor provides them
      if (bloodGroup)  record.patientSnapshot.bloodGroup = bloodGroup;
      if (allergies)   record.patientSnapshot.allergies  = allergies;
    }

    // ── Check if a note for this appointment already exists ───────────────────
    const existingIndex = record.consultationNotes.findIndex(
      (n) => String(n.appointmentId) === String(appointmentId)
    );

    const noteData = {
      appointmentId:        new mongoose.Types.ObjectId(appointmentId),
      doctorId:             new mongoose.Types.ObjectId(doctorId!),
      doctorName,
      doctorSpecialization,
      doctorLicenseNumber,
      consultationDate:     appointment.scheduledAt,
      chiefComplaint,
      vitalSigns:           vitalSigns           || undefined,
      diagnosis:            diagnosis            || [],
      prescriptions:        prescriptions        || [],
      labTests:             labTests             || [],
      followUpInstructions: followUpInstructions || undefined,
      followUpDate:         followUpDate         || undefined,
      privateNotes:         privateNotes         || undefined,
      attachments:          attachments          || [],
    };

    if (existingIndex >= 0) {
      // Update existing note
      Object.assign(record.consultationNotes[existingIndex], noteData);
    } else {
      // Add new note
      record.consultationNotes.push({
        _id: new mongoose.Types.ObjectId(),
        ...noteData,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);
    }

    await record.save();

    // Return note without privateNotes to keep response clean
    const savedNote = record.consultationNotes.find(
      (n) => String(n.appointmentId) === String(appointmentId)
    );

    const { privateNotes: _pn, ...publicNote } = (savedNote as any).toObject
      ? (savedNote as any).toObject()
      : savedNote as any;

    res.status(200).json({
      success: true,
      message: existingIndex >= 0 ? "Note updated successfully." : "Note created successfully.",
      data: publicNote,
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 2. GET PATIENT'S OWN RECORD (Patient)
//    GET /api/v1/medical-records/my
// ─────────────────────────────────────────────────────────────────────────────
export const getMyRecord = asyncHandler(
  async (req: Request, res: Response) => {
    const patientId = req.auth?.id;

    const record = await MedicalRecord.findOne({ patientId });

    if (!record) {
      return res.status(200).json({
        success: true,
        data: null,
        message: "No medical record found yet.",
      });
    }

    // Strip privateNotes from all notes before sending to patient
    const sanitized = {
      ...record.toObject(),
      consultationNotes: record.consultationNotes.map(
        ({ privateNotes: _pn, ...rest }: any) => rest
      ),
    };

    res.status(200).json({ success: true, data: sanitized });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. GET PATIENT'S RECORD (Doctor — requires approved AccessRequest)
//    GET /api/v1/medical-records/patient/:patientId
// ─────────────────────────────────────────────────────────────────────────────
export const getPatientRecord = asyncHandler(
  async (req: Request, res: Response) => {
    const doctorId  = req.auth?.id;
    const { patientId } = req.params;
    const { appointmentId } = req.query as { appointmentId?: string };

    // ── Verify approved access request ───────────────────────────────────────
    const accessRequest = await AccessRequest.findOne({
      patientId,
      requestingDoctorId: doctorId,
      status: "approved",
    });

    if (!accessRequest) {
      return res.status(403).json({
        success: false,
        message: "Access not granted. Please request access from the patient first.",
      });
    }

    const record = await MedicalRecord.findOne({ patientId });

    if (!record) {
      return res.status(404).json({
        success: false,
        message: "No medical record found for this patient.",
      });
    }

    // ── Strip privateNotes from OTHER doctors' notes ──────────────────────────
    // Requesting doctor can see their own private notes but not others'
    const sanitized = {
      ...record.toObject(),
      consultationNotes: record.consultationNotes.map((note: any) => {
        if (String(note.doctorId) === String(doctorId)) {
          return note; // own notes: full access including privateNotes
        }
        const { privateNotes: _pn, ...rest } = note.toObject ? note.toObject() : note;
        return rest;
      }),
    };

    // ── Log access ────────────────────────────────────────────────────────────
    const doctor = await Doctor.findById(doctorId).select("firstName lastName");
    record.accessLog.push({
      doctorId:      new mongoose.Types.ObjectId(doctorId!),
      doctorName:    doctor ? `Dr. ${doctor.lastName || doctor.firstName}` : "Unknown Doctor",
      appointmentId: new mongoose.Types.ObjectId(appointmentId || String(accessRequest.appointmentId)),
      accessedAt:    new Date(),
    });
    await record.save();

    // Notify patient that doctor accessed their record
    try {
      const doctorName = doctor ? `Dr. ${doctor.lastName || doctor.firstName}` : "Your doctor";
      await NotificationService.notifyRecordAccessed(
        String(patientId),
        String(record._id),
        doctorName
      );
    } catch (err) {
      console.error("❌ Failed to notify patient of record access:", err);
    }

    res.status(200).json({ success: true, data: sanitized });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 4. REQUEST ACCESS TO PATIENT RECORD (Doctor)
//    POST /api/v1/medical-records/request-access
// ─────────────────────────────────────────────────────────────────────────────
export const requestRecordAccess = asyncHandler(
  async (req: Request, res: Response) => {
    const doctorId = req.auth?.id;
    const { patientId, appointmentId } = req.body;

    if (!patientId || !appointmentId) {
      return res.status(400).json({
        success: false,
        message: "patientId and appointmentId are required.",
      });
    }

    // ── Ensure appointment exists and doctor is assigned ──────────────────────
    const appointment = await Appointment.findById(appointmentId);
    if (!appointment || extractId(appointment.doctorId) !== doctorId) {
      return res.status(403).json({
        success: false,
        message: "You can only request access for your own appointments.",
      });
    }

    // ── Check for existing pending/approved request for this appointment ──────
    const existing = await AccessRequest.findOne({ appointmentId });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: `An access request already exists for this appointment (status: ${existing.status}).`,
        data: existing,
      });
    }

    // ── Create request ────────────────────────────────────────────────────────
    const accessRequest = await AccessRequest.create({
      patientId,
      requestingDoctorId: doctorId,
      appointmentId,
      status:             "pending",
      requestedAt:        new Date(),
      expiresAt:          new Date(Date.now() + 48 * 60 * 60 * 1000), // 48h
      notifiedPatient:    false,
    });

    // ── Notify patient ────────────────────────────────────────────────────────
    const doctor = await Doctor.findById(doctorId).select("firstName lastName specialization");
    const doctorName = doctor ? `Dr. ${doctor.lastName || doctor.firstName}` : "Your doctor";

    try {
      await NotificationService.notifyRecordAccessRequest(
        String(patientId),
        String(accessRequest._id),
        doctorName,
        doctor?.specialization || ""
      );
      accessRequest.notifiedPatient = true;
      await accessRequest.save();
    } catch (err) {
      console.error("❌ Failed to notify patient of access request:", err);
    }

    res.status(201).json({
      success: true,
      message: "Access request sent to patient.",
      data: accessRequest,
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 5. RESPOND TO ACCESS REQUEST (Patient — approve or deny)
//    PATCH /api/v1/medical-records/access-request/:requestId/respond
// ─────────────────────────────────────────────────────────────────────────────
export const respondToAccessRequest = asyncHandler(
  async (req: Request, res: Response) => {
    const patientId = req.auth?.id;
    const { requestId } = req.params;
    const { approve } = req.body; // boolean

    const accessRequest = await AccessRequest.findById(requestId)
      .populate("requestingDoctorId", "firstName lastName specialization");

    if (!accessRequest) {
      return res.status(404).json({ success: false, message: "Access request not found." });
    }

    if (String(accessRequest.patientId) !== String(patientId)) {
      return res.status(403).json({ success: false, message: "This request is not for you." });
    }

    if (accessRequest.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: `This request has already been ${accessRequest.status}.`,
      });
    }

    if (new Date() > accessRequest.expiresAt) {
      accessRequest.status = "expired";
      await accessRequest.save();
      return res.status(400).json({ success: false, message: "This request has expired." });
    }

    // ── Update ────────────────────────────────────────────────────────────────
    accessRequest.status      = approve ? "approved" : "denied";
    accessRequest.respondedAt = new Date();
    await accessRequest.save();

    // ── Notify doctor ─────────────────────────────────────────────────────────
    const doctor = accessRequest.requestingDoctorId as any;
    const doctorName = doctor ? `Dr. ${doctor.lastName || doctor.firstName}` : "Doctor";

    try {
      await NotificationService.notifyRecordAccessResponse(
        String(accessRequest.requestingDoctorId),
        String(accessRequest.patientId),
        doctorName,
        approve
      );
    } catch (err) {
      console.error("❌ Failed to notify doctor of access response:", err);
    }

    // ── Emit real-time update ─────────────────────────────────────────────────
    emitAccessRequestUpdate(
      String(accessRequest.requestingDoctorId),
      String(requestId),
      accessRequest.status
    );

    res.status(200).json({
      success: true,
      message: approve ? "Access granted." : "Access denied.",
      data: accessRequest,
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 6. GET PENDING ACCESS REQUESTS FOR PATIENT
//    GET /api/v1/medical-records/access-requests/pending
// ─────────────────────────────────────────────────────────────────────────────
export const getPendingAccessRequests = asyncHandler(
  async (req: Request, res: Response) => {
    const patientId = req.auth?.id;

    const requests = await AccessRequest.find({
      patientId,
      status: "pending",
      expiresAt: { $gt: new Date() },
    }).populate("requestingDoctorId", "firstName lastName specialization doctorImage");

    res.status(200).json({ success: true, data: requests });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 7. GET ALL ACCESS REQUESTS FOR PATIENT (full history)
//    GET /api/v1/medical-records/access-requests
// ─────────────────────────────────────────────────────────────────────────────
export const getAllAccessRequests = asyncHandler(
  async (req: Request, res: Response) => {
    const patientId = req.auth?.id;

    const requests = await AccessRequest.find({ patientId })
      .populate("requestingDoctorId", "firstName lastName specialization doctorImage")
      .sort({ requestedAt: -1 });

    res.status(200).json({ success: true, data: requests });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 8. CHECK IF DOCTOR HAS ACCESS (Doctor — used by frontend before showing button)
//    GET /api/v1/medical-records/check-access/:patientId
// ─────────────────────────────────────────────────────────────────────────────
export const checkAccess = asyncHandler(
  async (req: Request, res: Response) => {
    const doctorId  = req.auth?.id;
    const { patientId } = req.params;

    const accessRequest = await AccessRequest.findOne({
      patientId,
      requestingDoctorId: doctorId,
      status: "approved",
    });

    const pendingRequest = await AccessRequest.findOne({
      patientId,
      requestingDoctorId: doctorId,
      status: "pending",
    });

    res.status(200).json({
      success: true,
      data: {
        hasAccess:     !!accessRequest,
        hasPending:    !!pendingRequest,
        accessRequest: accessRequest || pendingRequest || null,
      },
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 9. GENERATE PDF (Patient or Doctor with access)
//    GET /api/v1/medical-records/pdf/:patientId
// ─────────────────────────────────────────────────────────────────────────────
export const generateRecordPDF = asyncHandler(
  async (req: Request, res: Response) => {
    const requesterId = req.auth?.id;
    const role        = req.auth?.role;
    const { patientId } = req.params;

    // ── Access check ──────────────────────────────────────────────────────────
    if (role === "Doctor") {
      const access = await AccessRequest.findOne({
        patientId,
        requestingDoctorId: requesterId,
        status: "approved",
      });
      if (!access) {
        return res.status(403).json({ success: false, message: "Access not granted." });
      }
    } else if (role === "User" && String(requesterId) !== String(patientId)) {
      return res.status(403).json({ success: false, message: "You can only download your own record." });
    }

    const record = await MedicalRecord.findOne({ patientId });
    if (!record) {
      return res.status(404).json({ success: false, message: "No medical record found." });
    }

    // ── Build PDF ─────────────────────────────────────────────────────────────
    const doc = new PDFDocument({ margin: 50, size: "A4" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="PlanAmWell_MedicalRecord_${patientId}.pdf"`
    );
    doc.pipe(res);

    // Brand header
    doc.fontSize(22).fillColor("#D81E5B").text("PlanAmWell", { align: "center" });
    doc.fontSize(12).fillColor("#666").text("Medical Record", { align: "center" });
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#D81E5B").stroke();
    doc.moveDown();

    // Patient info
    const p = record.patientSnapshot;
    doc.fontSize(14).fillColor("#111").text("Patient Information", { underline: true });
    doc.fontSize(11).fillColor("#333");
    doc.text(`Name:           ${p.name}`);
    doc.text(`Gender:         ${p.gender         || "N/A"}`);
    doc.text(`Date of Birth:  ${p.dateOfBirth     || "N/A"}`);
    doc.text(`Phone:          ${p.phone           || "N/A"}`);
    doc.text(`Email:          ${p.email           || "N/A"}`);
    doc.text(`Blood Group:    ${p.bloodGroup      || "N/A"}`);
    doc.text(`Allergies:      ${p.allergies?.join(", ") || "None recorded"}`);
    doc.moveDown();

    // Consultation notes
    const notes = role === "Doctor"
      ? record.consultationNotes // doctor sees all (privateNotes of others already stripped above)
      : record.consultationNotes.map(({ privateNotes: _pn, ...rest }: any) => rest);

    notes.forEach((note: any, idx: number) => {
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#eee").stroke();
      doc.moveDown(0.5);

      doc.fontSize(13).fillColor("#D81E5B")
        .text(`Consultation ${idx + 1} — ${new Date(note.consultationDate).toLocaleDateString()}`);
      doc.fontSize(11).fillColor("#333");
      doc.text(`Doctor:        ${note.doctorName}  (${note.doctorSpecialization})`);
      doc.text(`License No:    ${note.doctorLicenseNumber}`);
      doc.moveDown(0.3);

      doc.fontSize(12).fillColor("#111").text("Chief Complaint:", { underline: true });
      doc.fontSize(11).fillColor("#333").text(note.chiefComplaint);
      doc.moveDown(0.3);

      // Vitals
      if (note.vitalSigns && Object.values(note.vitalSigns).some(Boolean)) {
        doc.fontSize(12).fillColor("#111").text("Vital Signs:", { underline: true });
        const v = note.vitalSigns;
        if (v.bloodPressure)    doc.text(`  BP:               ${v.bloodPressure}`);
        if (v.pulse)            doc.text(`  Pulse:            ${v.pulse}`);
        if (v.temperature)      doc.text(`  Temperature:      ${v.temperature}`);
        if (v.weight)           doc.text(`  Weight:           ${v.weight}`);
        if (v.height)           doc.text(`  Height:           ${v.height}`);
        if (v.bmi)              doc.text(`  BMI:              ${v.bmi}`);
        if (v.oxygenSaturation) doc.text(`  O₂ Saturation:   ${v.oxygenSaturation}`);
        doc.moveDown(0.3);
      }

      // Diagnosis
      if (note.diagnosis?.length > 0) {
        doc.fontSize(12).fillColor("#111").text("Diagnosis:", { underline: true });
        note.diagnosis.forEach((d: any) => {
          doc.fontSize(11).fillColor("#333")
            .text(`  • ${d.description}${d.code ? ` (${d.code})` : ""}${d.severity ? ` — ${d.severity}` : ""}`);
        });
        doc.moveDown(0.3);
      }

      // Prescriptions
      if (note.prescriptions?.length > 0) {
        doc.fontSize(12).fillColor("#111").text("Prescriptions:", { underline: true });
        note.prescriptions.forEach((rx: any) => {
          doc.fontSize(11).fillColor("#333")
            .text(`  • ${rx.drug} ${rx.dosage} (${rx.form}) — ${rx.frequency} for ${rx.duration}${rx.instructions ? `. ${rx.instructions}` : ""}`);
        });
        doc.moveDown(0.3);
      }

      // Lab tests
      if (note.labTests?.length > 0) {
        doc.fontSize(12).fillColor("#111").text("Lab Tests:", { underline: true });
        note.labTests.forEach((t: any) => {
          doc.fontSize(11).fillColor("#333")
            .text(`  • ${t.name}${t.result ? `: ${t.result} ${t.unit || ""}` : " (pending)"}${t.status ? ` — ${t.status}` : ""}`);
        });
        doc.moveDown(0.3);
      }

      // Follow-up
      if (note.followUpInstructions) {
        doc.fontSize(12).fillColor("#111").text("Follow-up Instructions:", { underline: true });
        doc.fontSize(11).fillColor("#333").text(note.followUpInstructions);
        if (note.followUpDate) {
          doc.text(`Follow-up Date: ${new Date(note.followUpDate).toLocaleDateString()}`);
        }
      }

      doc.moveDown();
    });

    // Footer
    doc.fontSize(9).fillColor("#aaa")
      .text(
        `Generated by PlanAmWell on ${new Date().toLocaleString()} — This document is confidential.`,
        { align: "center" }
      );

    doc.end();
  }
);