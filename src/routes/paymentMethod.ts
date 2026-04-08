// routes/paymentMethod.routes.ts
import { Router } from "express";
import { verifyToken } from "../middleware/auth";
import {
  getPaymentMethods,
  addPaymentMethod,
  updatePaymentMethod,
  deletePaymentMethod,
} from "../controllers/paymentMethodController";

const router = Router();

router.use(verifyToken);

router.get("/", getPaymentMethods);
router.post("/", addPaymentMethod);
router.patch("/:id", updatePaymentMethod); // set default / label
router.delete("/:id", deletePaymentMethod);

export default router;
``