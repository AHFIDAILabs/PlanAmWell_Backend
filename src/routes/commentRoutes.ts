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
import { verifyToken, authorize, guestAuth, hydrateUser } from "../middleware/auth";

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

// Edit a comment (requires authentication). hydrateUser populates req.user
// (the controller's ownership check reads req.user, not req.auth) — without
// it every call crashed with a raw 500 (`user._id` on undefined) regardless
// of whether the caller was actually authenticated.
commentRouter.put("/comments/:commentId", guestAuth, verifyToken, hydrateUser, editComment);

// Delete a comment (requires authentication) — same req.user fix as above.
commentRouter.delete("/comments/:commentId", guestAuth, verifyToken, hydrateUser, deleteComment);

// Like/Unlike a comment (requires authentication) — same req.user fix;
// previously always hit the controller's own "Authentication required" 401
// even for valid logged-in callers, since req.user was never populated.
commentRouter.post("/comments/:commentId/like", guestAuth, verifyToken, hydrateUser, toggleCommentLike);

// Flag a comment — the controller already requires req.user and rejects
// with 401 otherwise, but nothing here ever decoded a token to populate it,
// so every flag attempt failed. Gate it the same way the routes above do.
commentRouter.post("/comments/:commentId/flag", guestAuth, verifyToken, hydrateUser, flagComment);

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