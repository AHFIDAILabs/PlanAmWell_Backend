// routes/commentRoutes.ts
import express from "express";
import {
  getArticleComments,
  getCommentReplies,
  addComment,
  editComment,
  deleteComment,
  toggleCommentLike,
  flagComment,
  getAllCommentsAdmin,
  updateCommentStatus,
  getCommentStats,
} from "../controllers/commentController";
import { verifyToken, authorize, guestAuth } from "../middleware/auth";

const commentRouter = express.Router();

// =====================================================
// PUBLIC/USER ROUTES
// =====================================================

// Get comments for an article
commentRouter.get("/:articleId/comments", getArticleComments);

// Get replies to a specific comment
commentRouter.get("/comments/:commentId/replies", getCommentReplies);

// Add a comment (requires authentication)
commentRouter.post("/:articleId/comments", guestAuth, addComment);

// Edit a comment (requires authentication)
commentRouter.put("/comments/:commentId", guestAuth, verifyToken, editComment);

// Delete a comment (requires authentication)
commentRouter.delete("/comments/:commentId", guestAuth, verifyToken, deleteComment);

// Like/Unlike a comment (requires authentication)
commentRouter.post("/comments/:commentId/like", guestAuth, verifyToken, toggleCommentLike);

// Flag a comment
commentRouter.post("/comments/:commentId/flag", flagComment);

// =====================================================
// ADMIN ROUTES
// =====================================================

// Get all comments for moderation
commentRouter.get("/comments/admin/all", verifyToken, authorize("Admin"), getAllCommentsAdmin);

// Update comment status
commentRouter.put(
  "/comments/admin/:commentId/status",
  verifyToken,
  authorize("Admin"),
  updateCommentStatus
);

// Get comment statistics
commentRouter.get("/comments/admin/stats", verifyToken, authorize("Admin"), getCommentStats);

export default commentRouter;