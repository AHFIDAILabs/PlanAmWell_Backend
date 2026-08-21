import { Request, Response } from "express";
import axios, { AxiosError } from "axios";
import asyncHandler from "../middleware/asyncHandler";
import { memoryCache } from "../util/memoryCache";

const CATEGORIES_CACHE_KEY = "categories:all";
const CATEGORIES_CACHE_TTL_MS = 30 * 60 * 1000; // 30 min — categories change rarely

const BASE_URL = process.env.PARTNER_API_URL || "";

// Types for category response
interface ICategory {
  id: string;
  name: string;
  description: string | null;
  image: string | null;
  slug: string;
}

interface PartnerCategoryResponse {
  data: ICategory[];
}

// GET all categories (from 3rd-party API)
export const getAllCategories = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    try {
      // Was hitting the partner's external API on every single request for
      // data that almost never changes — now cached in-process.
      const categories = await memoryCache.getOrSet(
        CATEGORIES_CACHE_KEY,
        CATEGORIES_CACHE_TTL_MS,
        async () => {
          const response = await axios.get<PartnerCategoryResponse>(`${BASE_URL}/v1/categories`);
          return response.data.data;
        }
      );

      res.status(200).json({
        success: true,
        count: categories.length,
        categories,
      });
      return;
    } catch (err) {
      const error = err as AxiosError;

      console.error(
        "Error fetching categories:",
        error.response?.data || error.message
      );

      res.status(500).json({
        success: false,
        message: "Failed to fetch categories",
        error: error.response?.data || error.message,
      });
    }
  }
);
