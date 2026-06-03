import { Request, Response } from "express";
import { FamilyMember } from "../models/FamilyMember";

export const getMembers = async (req: Request, res: Response): Promise<Response> => {
  try {
    const userId = req.auth?.id;
    const members = await FamilyMember.find({ userId }).sort({ createdAt: -1 });
    return res.json({ success: true, data: members });
  } catch (err: any) {
    console.error("[FamilyMember] get error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to fetch family members" });
  }
};

export const createMember = async (req: Request, res: Response): Promise<Response> => {
  try {
    const userId = req.auth?.id;
    const { name, relationship, gender, dateOfBirth, bloodGroup, allergies, notes } = req.body;

    if (!name || !relationship) {
      return res.status(400).json({ success: false, message: "name and relationship are required" });
    }

    const member = await FamilyMember.create({
      userId,
      name: name.trim(),
      relationship,
      gender,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
      bloodGroup: bloodGroup?.trim(),
      allergies: allergies?.trim(),
      notes: notes?.trim(),
    });

    return res.status(201).json({ success: true, data: member });
  } catch (err: any) {
    console.error("[FamilyMember] create error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to create family member" });
  }
};

export const updateMember = async (req: Request, res: Response): Promise<Response> => {
  try {
    const userId = req.auth?.id;
    const { id } = req.params;
    const { name, relationship, gender, dateOfBirth, bloodGroup, allergies, notes } = req.body;

    const member = await FamilyMember.findOne({ _id: id, userId });
    if (!member) return res.status(404).json({ success: false, message: "Family member not found" });

    if (name !== undefined) member.name = name.trim();
    if (relationship !== undefined) member.relationship = relationship;
    if (gender !== undefined) member.gender = gender;
    if (dateOfBirth !== undefined) member.dateOfBirth = dateOfBirth ? new Date(dateOfBirth) : undefined;
    if (bloodGroup !== undefined) member.bloodGroup = bloodGroup?.trim();
    if (allergies !== undefined) member.allergies = allergies?.trim();
    if (notes !== undefined) member.notes = notes?.trim();

    await member.save();
    return res.json({ success: true, data: member });
  } catch (err: any) {
    console.error("[FamilyMember] update error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to update family member" });
  }
};

export const deleteMember = async (req: Request, res: Response): Promise<Response> => {
  try {
    const userId = req.auth?.id;
    const { id } = req.params;

    const deleted = await FamilyMember.findOneAndDelete({ _id: id, userId });
    if (!deleted) return res.status(404).json({ success: false, message: "Family member not found" });

    return res.json({ success: true, message: "Family member deleted" });
  } catch (err: any) {
    console.error("[FamilyMember] delete error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to delete family member" });
  }
};
