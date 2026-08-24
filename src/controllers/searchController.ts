import { Request, Response } from "express";
import asyncHandler from "../middleware/asyncHandler";
import { Doctor } from "../models/doctor";
import { Product } from "../models/product";
import { AdvocacyArticle } from "../models/advocacy";
import { Hospital } from "../models/hospital";

// Escapes regex metacharacters in free-text user input before it's used to
// build a RegExp — this is user-supplied search text hitting the query
// directly, so it must not be treated as a regex pattern itself.
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// GET /api/v1/search?q=<text>&limit=<n> — cross-resource search for the
// topbar search box, combining the same filters each resource's own list
// endpoint already uses (doctorController.getDoctors, productController's
// searchProducts, advocacyController's searchArticles, hospitalController's
// getHospitals) so results match what browsing each section would show.
export const globalSearch = asyncHandler(async (req: Request, res: Response) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q) {
    res.status(400).json({ success: false, message: "q is required" });
    return;
  }

  const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 5, 1), 20);
  const rx = new RegExp(escapeRegex(q), "i");

  const [doctors, products, articles, clinics] = await Promise.all([
    Doctor.find({
      status: "approved",
      $or: [{ firstName: rx }, { lastName: rx }, { specialization: rx }],
    })
      .select("-passwordHash")
      .populate("doctorImage")
      .limit(limit)
      .lean(),
    Product.find({
      stockQuantity: { $gt: 0 },
      status: { $ne: "inactive" },
      $or: [{ name: rx }, { categoryName: rx }, { manufacturerName: rx }],
    })
      .limit(limit)
      .lean(),
    AdvocacyArticle.find(
      { status: "published", $text: { $search: q } },
      { score: { $meta: "textScore" } }
    )
      .select("-content")
      .sort({ score: { $meta: "textScore" } })
      .limit(limit)
      .lean(),
    Hospital.find({
      isActive: true,
      $or: [{ name: rx }, { city: rx }, { state: rx }, { specialties: { $in: [rx] } }, { services: { $in: [rx] } }],
    })
      .limit(limit)
      .lean(),
  ]);

  res.status(200).json({ success: true, data: { doctors, products, articles, clinics } });
});
