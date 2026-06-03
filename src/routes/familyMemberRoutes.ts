import { Router } from "express";
import { verifyToken } from "../middleware/auth";
import { getMembers, createMember, updateMember, deleteMember } from "../controllers/familyMemberController";

const familyMemberRouter = Router();

familyMemberRouter.use(verifyToken);

familyMemberRouter.get("/", getMembers);
familyMemberRouter.post("/", createMember);
familyMemberRouter.put("/:id", updateMember);
familyMemberRouter.delete("/:id", deleteMember);

export default familyMemberRouter;
