import { Router } from "express";
import { getAllCategories } from "../controllers/categoryController";

const categoryRouter = Router();

// Public - anyone can browse categories
categoryRouter.get("/", getAllCategories);


export default categoryRouter;