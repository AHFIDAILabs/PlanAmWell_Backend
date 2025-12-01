// routes/advocacyRoutes.ts
import express from "express";
import {
  getArticles,
  getRecentArticles,
  getFeaturedArticles,
  getCategories,
  getTags,
  getArticleBySlug,
  searchArticles,
  likeArticle,
  createArticle,
  updateArticle,
  deleteArticle,
  getAllArticlesAdmin,
  getAdvocacyStats,
} from "../controllers/advocacyController";
import { verifyToken, guestAuth, authorize } from "../middleware/auth"; // Your auth middleware
import commentRouter from "./commentRoutes";

const advocacyRouter = express.Router();

// =====================================================
// PUBLIC ROUTES
// =====================================================
advocacyRouter.get("/", getArticles);
advocacyRouter.get("/recent", getRecentArticles);
advocacyRouter.get("/featured", getFeaturedArticles);
advocacyRouter.get("/categories", getCategories);
advocacyRouter.get("/tags", getTags);
advocacyRouter.get("/search", searchArticles);
advocacyRouter.get("/:slug", getArticleBySlug);
advocacyRouter.post("/:id/like", likeArticle);

// =====================================================
// ADMIN ROUTES (Protected)
// =====================================================
advocacyRouter.post("/admin", verifyToken, authorize("Admin"), createArticle);
advocacyRouter.put("/admin/:id", verifyToken, authorize("Admin"), updateArticle);
advocacyRouter.delete("/admin/:id", verifyToken, authorize("Admin"), deleteArticle);
advocacyRouter.get("/admin/all", verifyToken, authorize("Admin"), getAllArticlesAdmin);
advocacyRouter.get("/admin/stats", verifyToken, authorize("Admin"), getAdvocacyStats);
// Mount comment routes
advocacyRouter.use("/", commentRouter);

export default advocacyRouter;