// controllers/productController.ts
import { Request, Response } from "express";
import axios from "axios";
import asyncHandler from "../middleware/asyncHandler";
import { Product, IProduct } from "../models/product";
import Fuse from 'fuse.js';

const API_BASE = process.env.PARTNER_API_URL?.replace(/\/$/, ""); // remove trailing slash

/**
 * Fetch products from third-party API and map to DB schema
 */
export const fetchProductsFromAPI = async (): Promise<IProduct[]> => {
  const url = `${API_BASE}/PlanAmWell/inventory?page=1&limit=100`;

try {
  const response = await axios.get(url);
  const apiProducts = response.data.data;
  console.log("[Products] Fetched from API:", apiProducts.length);
  return apiProducts.map((p: any) => ({
    partnerId: p.id,
    partnerProductId: p.id,
    drugId: p.id,
    name: p.name,
    sku: p.sku,
    imageUrl: p.imageUrl,
    categoryName: p.categoryName,
    prescriptionRequired: p.prescriptionRequired,
    manufacturerName: p.manufacturerName,
    price: parseFloat(p.price),
    expired: p.expired ? new Date(p.expired) : null,
    stockQuantity: p.stockQuantity,
    status: p.status,
  }));
} catch (err: any) {
  console.error("[Products] Fetch from partner API failed:", err.response?.status, err.response?.data, url);
  throw new Error("Failed to fetch products from partner API");
}
};

/**
 * GET /products - paginated list of products
 */
export const getProducts = asyncHandler(async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const skip = (page - 1) * limit;

  let products = await Product.find({ partnerProductId: { $exists: true } })
  .skip(skip)
  .limit(limit);
  console.log(`[Products] Products in DB: ${products.length}`);

if (!products.length) {
  console.log("[Products] DB empty. Fetching from partner API...");
  const apiProducts = await fetchProductsFromAPI();
  console.log("[Products] Fetched from API:", apiProducts.length);

  if (apiProducts.length > 0) {
    const bulkOps = apiProducts.map((p) => ({
      updateOne: {
        filter: { partnerProductId: p.partnerProductId },
        update: { $set: p },
        upsert: true,
      },
    }));

    await Product.bulkWrite(bulkOps);
    console.log(`[Products] Upserted ${apiProducts.length} products.`);

    // ✅ Re-query DB
    products = await Product.find({ partnerId: { $exists: true } })
      .skip(skip)
      .limit(limit);

    console.log(`[Products] Products after fetch: ${products.length}`);
  }
}
  res.status(200).json({ success: true, data: products, page, limit });
});

/**
 * GET /products/:id - fetch single product
 */
export const getProduct = asyncHandler(async (req: Request, res: Response) => {
  const productId = req.params.id;
  let product = await Product.findOne({ $or: [{ _id: productId }, { partnerId: productId }] });

  if (!product) {
    const apiProducts = await fetchProductsFromAPI();
    const apiProduct = apiProducts.find((p) => p.partnerId === productId);

    if (!apiProduct) return res.status(404).json({ success: false, message: "Product not found" });

    product = await Product.create(apiProduct);
  }

  res.status(200).json({ success: true, data: product });
});

/**
 * POST /products/sync - admin only
 */
export const syncProducts = asyncHandler(async (req: Request, res: Response) => {
  const { page = 1, limit = 200 } = req.query;
  const url = `${API_BASE}/PlanAmWell/inventory?page=${page}&limit=${limit}`;

  try {
    const response = await axios.get(url);
    const products = response.data.data;

    const bulkOps = products.map((p: any) => ({
      updateOne: {
        filter: { partnerProductId: p.id },
        update: {
          $setOnInsert: {
            partnerId: p.id,
            partnerProductId: p.id,
            drugId: p.id,
            name: p.name,
            sku: p.sku,
            imageUrl: p.imageUrl,
            categoryName: p.categoryName,
            prescriptionRequired: p.prescriptionRequired,
            manufacturerName: p.manufacturerName,
            price: parseFloat(p.price),
            expired: p.expired ? new Date(p.expired) : null,
            stockQuantity: p.stockQuantity,
            status: p.status,
          },
          $set: {
            partnerId: p.id,
            drugId: p.id,
            partnerProductId: p.id,
          },
        },
        upsert: true,
      },
    }));

    await Product.bulkWrite(bulkOps);
    console.log(`[Products] Synced ${products.length} products from partner API.`);

    res.status(200).json({
      success: true,
      message: "Products synced successfully",
      count: products.length,
    });
  } catch (err: any) {
    console.error("[Products] Sync failed:", err.response?.status, err.response?.statusText, url);
    res.status(500).json({ success: false, message: "Failed to sync products from partner API" });
  }
});

// Search products (public endpoint for chatbot)
export const searchProducts = async (req: Request, res: Response): Promise<void> => {
    try {
        const { query, category, limit = '10' } = req.query;
        
        if (!query || typeof query !== 'string') {
            res.status(400).json({ success: false, message: 'Search query is required' });
            return;
        }
        
        // Get all available products
        let baseQuery: any = {
            stockQuantity: { $gt: 0 },
            status: { $ne: 'inactive' }
        };
        
        if (category) {
            baseQuery.categoryName = { $regex: category, $options: 'i' };
        }
        
        const allProducts = await Product.find(baseQuery).lean<IProduct[]>();
        
        // ✅ Use fuzzy search
        const fuse = new Fuse(allProducts, {
            keys: ['name', 'categoryName', 'manufacturerName'],
            threshold: 0.4, // 0 = exact match, 1 = match anything
            includeScore: true
        });
        
        const results = fuse.search(query).slice(0, parseInt(limit as string));
        const products = results.map(result => result.item);
        
        res.status(200).json({
            success: true,
            count: products.length,
            products
        });
        
    } catch (error: any) {
        console.error('Error searching products:', error);
        res.status(500).json({ success: false, message: 'Error searching products', error: error.message });
    }
};


// Get products by category
export const getProductsByCategory = async (req: Request, res: Response): Promise<void> => {
    try {
        const { category } = req.params;
        const { limit = '20' } = req.query;
        
        const products = await Product.find({ 
            categoryName: { $regex: category, $options: 'i' },
            stockQuantity: { $gt: 0 },
            status: { $ne: 'inactive' }
        })
        .limit(parseInt(limit as string))
        .lean<IProduct[]>();
        
        res.status(200).json({
            success: true,
            count: products.length,
            products
        });
        
    } catch (error: any) {
        console.error('Error fetching products:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error fetching products',
            error: error.message 
        });
    }
};
