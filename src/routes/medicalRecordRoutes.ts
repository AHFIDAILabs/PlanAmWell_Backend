import { Router } from "express";
import {
  createOrUpdateNote,
  getMyRecord,
  getPatientRecord,
  requestRecordAccess,
  respondToAccessRequest,
  getPendingAccessRequests,
  getAllAccessRequests,
  checkAccess,
  generateRecordPDF,
} from "../controllers/medicalRecordController";
import { verifyToken, authorize } from "../middleware/auth";
 
const medicalRecordRouter = Router();
 
medicalRecordRouter.use(verifyToken);
 
// ── Doctor routes ─────────────────────────────────────────────────────────────
medicalRecordRouter.post(   "/note",                          authorize("Doctor"),         createOrUpdateNote);
medicalRecordRouter.post(   "/request-access",                authorize("Doctor"),         requestRecordAccess);
medicalRecordRouter.get(    "/patient/:patientId",            authorize("Doctor"),         getPatientRecord);
medicalRecordRouter.get(    "/check-access/:patientId",       authorize("Doctor"),         checkAccess);
 
// ── Patient routes ────────────────────────────────────────────────────────────
medicalRecordRouter.get(    "/my",                            authorize("User"),           getMyRecord);
medicalRecordRouter.patch(  "/access-request/:requestId/respond", authorize("User"),       respondToAccessRequest);
medicalRecordRouter.get(    "/access-requests/pending",       authorize("User"),           getPendingAccessRequests);
medicalRecordRouter.get(    "/access-requests",               authorize("User"),           getAllAccessRequests);
 
// ── Shared (patient downloads own PDF; doctor downloads with approved access) ─
medicalRecordRouter.get(    "/pdf/:patientId",                authorize("User", "Doctor"), generateRecordPDF);
 
export default medicalRecordRouter;
 