import { Router } from "express";
import { verifyToken, authorize, guestAuth } from "../middleware/auth";
import { getProduct, getProducts, syncProducts, searchProducts,
    getProductsByCategory } from "../controllers/productController";


const productRouter = Router();

// Public - anyone can browse products
// NOTE: "/search" and "/category/:category" must be registered before
// "/:id" — Express matches routes in registration order, so "/:id" would
// otherwise swallow "/search" as a request for the product with id "search".
productRouter.get("/",guestAuth, getProducts);
productRouter.get("/search", guestAuth, searchProducts);
productRouter.get("/category/:category", getProductsByCategory);
productRouter.get("/:id", guestAuth, getProduct);

// Admin only - sync products from third-party API
productRouter.post("/sync", verifyToken, authorize("Admin"), syncProducts);

export default productRouter;