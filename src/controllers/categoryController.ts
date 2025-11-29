import { Request, Response } from "express";
import axios, { AxiosError } from "axios";
import asyncHandler from "../middleware/asyncHandler";

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
      const response = await axios.get<PartnerCategoryResponse>(`${BASE_URL}/v1/categories`);

      res.status(200).json({
        success: true,
        count: response.data.data.length,
        categories: response.data.data,
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
