// controllers/commentController.ts
import { Request, Response } from "express";
import { Comment } from "../models/comment";
import { AdvocacyArticle } from "../models/advocacy";
import asyncHandler from "../middleware/asyncHandler";
import mongoose from "mongoose";

// =====================================================
// PUBLIC/USER ROUTES
// =====================================================

// GET /api/v1/advocacy/:articleId/comments - Get all comments for an article
export const getArticleComments = asyncHandler(async (req: Request, res: Response) => {
  const { articleId } = req.params;
  const { page = 1, limit = 20, sort = "-createdAt" } = req.query;

  // Verify article exists
  const article = await AdvocacyArticle.findById(articleId);
  if (!article) {
    return res.status(404).json({
      success: false,
      message: "Article not found",
    });
  }

  if (!article.commentsEnabled) {
    return res.status(403).json({
      success: false,
      message: "Comments are disabled for this article",
    });
  }

  const pageNum = parseInt(page as string, 10);
  const limitNum = parseInt(limit as string, 10);
  const skip = (pageNum - 1) * limitNum;

  // Get top-level comments (no parent)
  const comments = await Comment.find({
    articleId,
    parentCommentId: null,
    status: "approved",
  })
    .populate("author.userId", "name userImage")
    .populate({
      path: "replies",
      match: { status: "approved" },
      options: { sort: "createdAt" },
      populate: {
        path: "author.userId",
        select: "name userImage",
      },
    })
    .sort(sort as string)
    .skip(skip)
    .limit(limitNum)
    .lean();

  const total = await Comment.countDocuments({
    articleId,
    parentCommentId: null,
    status: "approved",
  });

  res.status(200).json({
    success: true,
    data: comments,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum),
    },
  });
});

// GET /api/v1/advocacy/comments/:commentId/replies - Get replies to a comment
export const getCommentReplies = asyncHandler(async (req: Request, res: Response) => {
  const { commentId } = req.params;

  const comment = await Comment.findById(commentId);
  if (!comment) {
    return res.status(404).json({
      success: false,
      message: "Comment not found",
    });
  }

  const replies = await Comment.find({
    parentCommentId: commentId,
    status: "approved",
  })
    .populate("author.userId", "name userImage")
    .sort("createdAt")
    .lean();

  res.status(200).json({
    success: true,
    data: replies,
  });
});

// POST /api/v1/advocacy/:articleId/comments - Add a comment
export const addComment = asyncHandler(async (req: Request, res: Response) => {
  const { articleId } = req.params;
  const { content, parentCommentId } = req.body;
  const user = (req as any).user; // From auth middleware

  if (!content || content.trim().length === 0) {
    return res.status(400).json({
      success: false,
      message: "Comment content is required",
    });
  }

  // Verify article exists and comments are enabled
  const article = await AdvocacyArticle.findById(articleId);
  if (!article) {
    return res.status(404).json({
      success: false,
      message: "Article not found",
    });
  }

  if (!article.commentsEnabled) {
    return res.status(403).json({
      success: false,
      message: "Comments are disabled for this article",
    });
  }

  let depth = 0;
  let parentComment = null;

  // If replying to a comment, verify it exists and check depth
  if (parentCommentId) {
    parentComment = await Comment.findById(parentCommentId);
    if (!parentComment) {
      return res.status(404).json({
        success: false,
        message: "Parent comment not found",
      });
    }

    depth = parentComment.depth + 1;

    if (depth > 3) {
      return res.status(400).json({
        success: false,
        message: "Maximum reply depth (3 levels) exceeded",
      });
    }
  }

  // Create comment
  const comment = await Comment.create({
    articleId,
    userId: user?._id,
    author: {
      name: user?.name || "Anonymous",
      email: user?.email,
      userId: user?._id,
    },
    content: content.trim(),
    parentCommentId: parentCommentId || null,
    depth,
    status: user ? "approved" : "pending", // Auto-approve for registered users
  });

  // Update article comment count (only for top-level comments)
  if (!parentCommentId) {
    await AdvocacyArticle.findByIdAndUpdate(articleId, {
      $inc: { commentsCount: 1 },
    });
  }

  // Populate author info before returning
  await comment.populate("author.userId", "name userImage");

  res.status(201).json({
    success: true,
    message: "Comment added successfully",
    data: comment,
  });
});

// PUT /api/v1/advocacy/comments/:commentId - Edit a comment
export const editComment = asyncHandler(async (req: Request, res: Response) => {
  const { commentId } = req.params;
  const { content } = req.body;
  const user = (req as any).user;

  if (!content || content.trim().length === 0) {
    return res.status(400).json({
      success: false,
      message: "Comment content is required",
    });
  }

  const comment = await Comment.findById(commentId);

  if (!comment) {
    return res.status(404).json({
      success: false,
      message: "Comment not found",
    });
  }

  // Check ownership
  if (comment.userId?.toString() !== user._id.toString()) {
    return res.status(403).json({
      success: false,
      message: "You can only edit your own comments",
    });
  }

  // Update comment
  comment.content = content.trim();
  comment.isEdited = true;
  comment.editedAt = new Date();
  await comment.save();

  res.status(200).json({
    success: true,
    message: "Comment updated successfully",
    data: comment,
  });
});

// DELETE /api/v1/advocacy/comments/:commentId - Delete a comment
export const deleteComment = asyncHandler(async (req: Request, res: Response) => {
  const { commentId } = req.params;
  const user = (req as any).user;

  const comment = await Comment.findById(commentId);

  if (!comment) {
    return res.status(404).json({
      success: false,
      message: "Comment not found",
    });
  }

  // Check ownership or admin role
  const isOwner = comment.userId?.toString() === user._id.toString();
  const isAdmin = user.roles?.includes("Admin");

  if (!isOwner && !isAdmin) {
    return res.status(403).json({
      success: false,
      message: "You can only delete your own comments",
    });
  }

  // Update article comment count (only for top-level comments)
  if (!comment.parentCommentId) {
    await AdvocacyArticle.findByIdAndUpdate(comment.articleId, {
      $inc: { commentsCount: -1 },
    });
  }

  // Delete comment (middleware will handle child deletion)
  await Comment.findByIdAndDelete(commentId);

  res.status(200).json({
    success: true,
    message: "Comment deleted successfully",
  });
});

// POST /api/v1/advocacy/comments/:commentId/like - Like/Unlike a comment
export const toggleCommentLike = asyncHandler(async (req: Request, res: Response) => {
  const { commentId } = req.params;
  const user = (req as any).user;

  if (!user) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
    });
  }

  const comment = await Comment.findById(commentId);

  if (!comment) {
    return res.status(404).json({
      success: false,
      message: "Comment not found",
    });
  }

  const userId = new mongoose.Types.ObjectId(user._id);
  const hasLiked = comment.likedBy.some((id) => id.equals(userId));

  if (hasLiked) {
    // Unlike
    comment.likedBy = comment.likedBy.filter((id) => !id.equals(userId));
    comment.likes = Math.max(0, comment.likes - 1);
  } else {
    // Like
    comment.likedBy.push(userId);
    comment.likes += 1;
  }

  await comment.save();

  res.status(200).json({
    success: true,
    message: hasLiked ? "Comment unliked" : "Comment liked",
    data: {
      likes: comment.likes,
      hasLiked: !hasLiked,
    },
  });
});

// POST /api/v1/advocacy/comments/:commentId/flag - Flag a comment
export const flagComment = asyncHandler(async (req: Request, res: Response) => {
  const { commentId } = req.params;
  const { reason } = req.body;

  const comment = await Comment.findByIdAndUpdate(
    commentId,
    { status: "flagged" },
    { new: true }
  );

  if (!comment) {
    return res.status(404).json({
      success: false,
      message: "Comment not found",
    });
  }

  // TODO: Send notification to admin about flagged comment
  console.log(`Comment ${commentId} flagged. Reason: ${reason}`);

  res.status(200).json({
    success: true,
    message: "Comment flagged for review",
  });
});

// =====================================================
// ADMIN ROUTES
// =====================================================

// GET /api/v1/advocacy/comments/admin/all - Get all comments (for moderation)
export const getAllCommentsAdmin = asyncHandler(async (req: Request, res: Response) => {
  const { status, articleId, page = 1, limit = 50 } = req.query;

  const query: any = {};
  if (status) query.status = status;
  if (articleId) query.articleId = articleId;

  const pageNum = parseInt(page as string, 10);
  const limitNum = parseInt(limit as string, 10);
  const skip = (pageNum - 1) * limitNum;

  const comments = await Comment.find(query)
    .populate("author.userId", "name email userImage")
    .populate("articleId", "title slug")
    .sort("-createdAt")
    .skip(skip)
    .limit(limitNum)
    .lean();

  const total = await Comment.countDocuments(query);

  res.status(200).json({
    success: true,
    data: comments,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum),
    },
  });
});

// PUT /api/v1/advocacy/comments/admin/:commentId/status - Update comment status
export const updateCommentStatus = asyncHandler(async (req: Request, res: Response) => {
  const { commentId } = req.params;
  const { status } = req.body;

  const validStatuses = ["pending", "approved", "rejected", "flagged"];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      message: "Invalid status",
    });
  }

  const comment = await Comment.findByIdAndUpdate(
    commentId,
    { status },
    { new: true }
  );

  if (!comment) {
    return res.status(404).json({
      success: false,
      message: "Comment not found",
    });
  }

  res.status(200).json({
    success: true,
    message: "Comment status updated",
    data: comment,
  });
});

// GET /api/v1/advocacy/comments/admin/stats - Get comment statistics
export const getCommentStats = asyncHandler(async (req: Request, res: Response) => {
  const [total, approved, pending, flagged, rejected] = await Promise.all([
    Comment.countDocuments(),
    Comment.countDocuments({ status: "approved" }),
    Comment.countDocuments({ status: "pending" }),
    Comment.countDocuments({ status: "flagged" }),
    Comment.countDocuments({ status: "rejected" }),
  ]);

  const topCommenters = await Comment.aggregate([
    { $match: { status: "approved" } },
    {
      $group: {
        _id: "$userId",
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
    { $limit: 10 },
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "user",
      },
    },
    { $unwind: "$user" },
    {
      $project: {
        name: "$user.name",
        email: "$user.email",
        count: 1,
      },
    },
  ]);

  const mostCommentedArticles = await Comment.aggregate([
    { $match: { status: "approved" } },
    {
      $group: {
        _id: "$articleId",
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
    { $limit: 10 },
    {
      $lookup: {
        from: "advocacyarticles",
        localField: "_id",
        foreignField: "_id",
        as: "article",
      },
    },
    { $unwind: "$article" },
    {
      $project: {
        title: "$article.title",
        slug: "$article.slug",
        count: 1,
      },
    },
  ]);

  res.status(200).json({
    success: true,
    data: {
      total,
      approved,
      pending,
      flagged,
      rejected,
      topCommenters,
      mostCommentedArticles,
    },
  });
});