// controllers/advocacyController.ts
import { Request, Response } from "express";
import { AdvocacyArticle } from "../models/advocacy";
import { Comment } from "../models/comment";
import asyncHandler from "../middleware/asyncHandler";
import slugify from "slugify"; 

// =====================================================
// PUBLIC ROUTES (No Authentication Required)
// =====================================================

// GET /api/v1/advocacy - Get all published articles with filters
export const getArticles = asyncHandler(async (req: Request, res: Response) => {
  const {
    category,
    tag,
    featured,
    search,
    page = 1,
    limit = 10,
    sort = "-publishedAt",
  } = req.query;

  // Build query
  const query: any = { status: "published" };

  if (category) query.category = category;
  if (tag) query.tags = { $in: [tag] };
  if (featured === "true") query.featured = true;
  if (search) {
    query.$text = { $search: search as string };
  }

  // Calculate pagination
  const pageNum = parseInt(page as string, 10);
  const limitNum = parseInt(limit as string, 10);
  const skip = (pageNum - 1) * limitNum;

  // Execute query
  const articles = await AdvocacyArticle.find(query)
    .select("-content") // Exclude full content for list view
    .sort(sort as string)
    .skip(skip)
    .limit(limitNum)
    .lean();

  const total = await AdvocacyArticle.countDocuments(query);

  res.status(200).json({
    success: true,
    data: articles,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum),
    },
  });
});

// GET /api/v1/advocacy/recent - Get recent articles
export const getRecentArticles = asyncHandler(async (req: Request, res: Response) => {
  const { limit = 5 } = req.query;

  const articles = await AdvocacyArticle.find({ status: "published" })
    .select("-content")
    .sort("-publishedAt")
    .limit(parseInt(limit as string, 10))
    .lean();

  res.status(200).json({
    success: true,
    data: articles,
  });
});

// GET /api/v1/advocacy/featured - Get featured articles
export const getFeaturedArticles = asyncHandler(async (req: Request, res: Response) => {
  const { limit = 3 } = req.query;

  const articles = await AdvocacyArticle.find({
    status: "published",
    featured: true,
  })
    .select("-content")
    .sort("-publishedAt")
    .limit(parseInt(limit as string, 10))
    .lean();

  res.status(200).json({
    success: true,
    data: articles,
  });
});

// GET /api/v1/advocacy/categories - Get all categories with counts
export const getCategories = asyncHandler(async (req: Request, res: Response) => {
  const categories = await AdvocacyArticle.aggregate([
    { $match: { status: "published" } },
    {
      $group: {
        _id: "$category",
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        category: "$_id",
        count: 1,
        _id: 0,
      },
    },
  ]);

  res.status(200).json({
    success: true,
    data: categories,
  });
});

// GET /api/v1/advocacy/tags - Get all tags
export const getTags = asyncHandler(async (req: Request, res: Response) => {
  const tags = await AdvocacyArticle.aggregate([
    { $match: { status: "published" } },
    { $unwind: "$tags" },
    {
      $group: {
        _id: "$tags",
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        tag: "$_id",
        count: 1,
        _id: 0,
      },
    },
    { $sort: { count: -1 } },
  ]);

  res.status(200).json({
    success: true,
    data: tags,
  });
});

// GET /api/v1/advocacy/:slug - Get single article by slug
export const getArticleBySlug = asyncHandler(async (req: Request, res: Response) => {
  const { slug } = req.params;

  const article = await AdvocacyArticle.findOne({
    slug,
    status: "published",
  }).populate("relatedArticles", "title slug excerpt featuredImage category");

  if (!article) {
    return res.status(404).json({
      success: false,
      message: "Article not found",
    });
  }

  // Increment views
  article.views += 1;
  await article.save();

  res.status(200).json({
    success: true,
    data: article,
  });
});

// GET /api/v1/advocacy/search - Advanced search
export const searchArticles = asyncHandler(async (req: Request, res: Response) => {
  const { q, category, tags, page = 1, limit = 10 } = req.query;

  if (!q) {
    return res.status(400).json({
      success: false,
      message: "Search query is required",
    });
  }

  const query: any = {
    status: "published",
    $text: { $search: q as string },
  };

  if (category) query.category = category;
  if (tags) {
    const tagArray = (tags as string).split(",");
    query.tags = { $in: tagArray };
  }

  const pageNum = parseInt(page as string, 10);
  const limitNum = parseInt(limit as string, 10);
  const skip = (pageNum - 1) * limitNum;

  const articles = await AdvocacyArticle.find(query, {
    score: { $meta: "textScore" },
  })
    .select("-content")
    .sort({ score: { $meta: "textScore" } })
    .skip(skip)
    .limit(limitNum)
    .lean();

  const total = await AdvocacyArticle.countDocuments(query);

  res.status(200).json({
    success: true,
    data: articles,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum),
    },
  });
});

// POST /api/v1/advocacy/:id/like - Like an article
export const likeArticle = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const article = await AdvocacyArticle.findByIdAndUpdate(
    id,
    { $inc: { likes: 1 } },
    { new: true }
  ).select("likes");

  if (!article) {
    return res.status(404).json({
      success: false,
      message: "Article not found",
    });
  }

  res.status(200).json({
    success: true,
    data: { likes: article.likes },
  });
});

// =====================================================
// ADMIN ROUTES (Authentication & Authorization Required)
// =====================================================

// POST /api/v1/advocacy/admin - Create new article (with partner)
export const createArticle = asyncHandler(async (req: Request, res: Response) => {
  const {
    title,
    excerpt,
    content,
    category,
    tags,
    author,
    slug,
    status,
    featured,
    metadata,
    partner,
  } = req.body;

  // featuredImage if uploaded via multer -> file.path or file?.secure_url
  let featuredImage = req.file?.path || req.body.featuredImage || undefined;
  // If Cloudinary storage used: req.file.path will be the Cloudinary url


  const articleSlug = slugify(title, { lower: true, strict: true });

  const article = await AdvocacyArticle.create({
    title,
    excerpt,
    slug: articleSlug || `article-${Date.now()}`,
    content,
    category,
    tags,
    author,
    featuredImage: featuredImage ? { url: featuredImage } : undefined, // <-- wrap as object
    status: status || "draft",
    featured: featured || false,
    metadata,
    partner,
  });

  res.status(201).json({
    success: true,
    message: "Article created successfully",
    data: article,
  });
});

// PUT /api/v1/advocacy/admin/:id - update w/ partner and image support
export const updateArticle = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id;
  const updatePayload = { ...req.body };

  if (req.file?.path) updatePayload.featuredImage = req.file.path;

  const article = await AdvocacyArticle.findByIdAndUpdate(id, updatePayload, {
    new: true,
    runValidators: true,
  });

  if (!article) {
    res.status(404);
    throw new Error("Article not found");
  }

  res.status(200).json({ success: true, data: article, message: "Updated" });
});


// DELETE /api/v1/advocacy/admin/:id - Delete article
export const deleteArticle = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const article = await AdvocacyArticle.findByIdAndDelete(id);

  if (!article) {
    return res.status(404).json({
      success: false,
      message: "Article not found",
    });
  }

  res.status(200).json({
    success: true,
    message: "Article deleted successfully",
  });
});

// GET /api/v1/advocacy/admin/all - Get all articles (including drafts)
export const getAllArticlesAdmin = asyncHandler(async (req: Request, res: Response) => {
  const { status, category, page = 1, limit = 20 } = req.query;

  const query: any = {};
  if (status) query.status = status;
  if (category) query.category = category;

  const pageNum = parseInt(page as string, 10);
  const limitNum = parseInt(limit as string, 10);
  const skip = (pageNum - 1) * limitNum;

  const articles = await AdvocacyArticle.find(query)
    .sort("-createdAt")
    .skip(skip)
    .limit(limitNum)
    .lean();

  const total = await AdvocacyArticle.countDocuments(query);

  res.status(200).json({
    success: true,
    data: articles,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum),
    },
  });
});

// GET /api/v1/advocacy/admin/stats - Get advocacy statistics
export const getAdvocacyStats = asyncHandler(async (req: Request, res: Response) => {
  const [totalArticles, publishedArticles, draftArticles, totalViews, totalLikes] =
    await Promise.all([
      AdvocacyArticle.countDocuments(),
      AdvocacyArticle.countDocuments({ status: "published" }),
      AdvocacyArticle.countDocuments({ status: "draft" }),
      AdvocacyArticle.aggregate([
        { $group: { _id: null, total: { $sum: "$views" } } },
      ]).then((result) => result[0]?.total || 0),
      AdvocacyArticle.aggregate([
        { $group: { _id: null, total: { $sum: "$likes" } } },
      ]).then((result) => result[0]?.total || 0),
    ]);

  const categoryStats = await AdvocacyArticle.aggregate([
    {
      $group: {
        _id: "$category",
        count: { $sum: 1 },
        views: { $sum: "$views" },
        likes: { $sum: "$likes" },
      },
    },
  ]);

  res.status(200).json({
    success: true,
    data: {
      totalArticles,
      publishedArticles,
      draftArticles,
      totalViews,
      totalLikes,
      categoryStats,
    },
  });
});