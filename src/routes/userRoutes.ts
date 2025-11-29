import { Router } from "express";
import {
  getUsers,
  getUser,
  updateUser,
  getUserProfile,
  deleteUser,
  deleteUserImage
} from "../controllers/userController";
import { verifyToken, authorize, guestAuth } from "../middleware/auth";
import multer from "multer";
const storage = multer.memoryStorage();

const fileFilter = (req: any, file: any, cb: any) => {
  // Accept images only
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Only image files are allowed!"), false);
  }
};
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});


const userRouter = Router();
/**
 * ADMIN — get list of users
 */
userRouter.get("/", verifyToken, authorize("Admin"), getUsers);

/**
 * ANY AUTH USER — get specific user
 * but controller/middleware must check `req.user.id === params.id` unless Admin
 */
userRouter.get("/:id", verifyToken, authorize("User", "Doctor", "Admin"), getUser);

/**
 * AUTH USER — get own profile
 */
// ✅ Add guestAuth BEFORE verifyToken to populate req.auth
userRouter.get(
  "/profile/me", 
  guestAuth,      // ← Parse and populate req.auth first
  verifyToken,    // ← Then verify user is authenticated (not guest)
  authorize("User", "Doctor", "Admin"), 
  getUserProfile
);
/**
 * ONLY USER can get their own profile
 * Admin & Doctor should NOT get users    
 */



userRouter.put(
  "/:id",
  guestAuth,
  verifyToken,
  authorize("User"),
  upload.single("userImage"), // ← parse single file field named 'userImage'
  updateUser
);


userRouter.delete(
  "/:id/image",
  verifyToken,
  authorize("User"),
  deleteUserImage
);  



/**
 * ONLY ADMIN CAN DELETE A USER
 */
userRouter.delete("/:id", verifyToken, authorize("Admin"), deleteUser);

export default userRouter;
