import { Router } from "express";
import { verifyToken, authorize, guestAuth } from "../middleware/auth";
import { getProduct, getProducts, syncProducts, searchProducts,
    getProductsByCategory } from "../controllers/productController";


const productRouter = Router();

// Public - anyone can browse products
productRouter.get("/",guestAuth, getProducts);
productRouter.get("/:id", guestAuth, getProduct);
productRouter.get("/search", guestAuth, searchProducts);
productRouter.get("/category/:category", getProductsByCategory);

// Admin only - sync products from third-party API
productRouter.post("/sync", verifyToken, authorize("Admin"), syncProducts);

export default productRouter;