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
  getArticleStats
} from "../controllers/advocacyController";
import { verifyToken, guestAuth, authorize } from "../middleware/auth"; // Your auth middleware
import commentRouter from "./commentRoutes";


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

// --------- Logging wrapper ---------
// const createArticleWithLogging = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
//   try {
//     console.log("\n[createArticleWithLogging] ---- START ----");

//     // Log headers
//     console.log("[createArticleWithLogging] Headers:", req.headers);

//     // Log auth
//     console.log("[createArticleWithLogging] req.auth:", req.auth);
//     console.log("[createArticleWithLogging] req.user:", req.user);

//     // Log body fields
//     console.log("[createArticleWithLogging] req.body:", req.body);

//     // Log file info
//     if (req.file) {
//       console.log("[createArticleWithLogging] Uploaded file:", {
//         originalname: req.file.originalname,
//         mimetype: req.file.mimetype,
//         size: req.file.size,
//       });
//     } else {
//       console.log("[createArticleWithLogging] No file uploaded");
//     }

//     // Call original controller
//     await createArticle(req, res, next);

//     console.log("[createArticleWithLogging] ---- END ----\n");
//   } catch (err) {
//     console.error("[createArticleWithLogging] Error:", err);
//     next(err);
//   }
// };

// =====================================================
// ADMIN ROUTES (Protected)
// =====================================================

advocacyRouter.post("",)
advocacyRouter.post(
  "/admin",
  guestAuth,
  verifyToken,
  authorize("Admin"),
  upload.single("featuredImage"),
  createArticle
);
advocacyRouter.put("/admin/:id", guestAuth, verifyToken, authorize("Admin"), upload.single("featuredImage"), updateArticle);
advocacyRouter.delete("/admin/:id", guestAuth, verifyToken, authorize("Admin"), deleteArticle);
advocacyRouter.get("/admin/all", guestAuth, verifyToken, authorize("Admin"), getAllArticlesAdmin);
advocacyRouter.get("/admin/stats",guestAuth, verifyToken, authorize("Admin"), getAdvocacyStats);
advocacyRouter.get("/admin/stats/:id", guestAuth, verifyToken, authorize("Admin"), getArticleStats);
// Mount comment routes
advocacyRouter.use("/", commentRouter);

export default advocacyRouter;
