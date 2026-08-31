import { Router } from "express";
import multer from "multer";
import { guestAuth, verifyToken, authorize } from "../middleware/auth";
import {
  getEvents,
  getAllEventsAdmin,
  getEventById,
  createEvent,
  updateEvent,
  deleteEvent,
  rsvpToEvent,
  cancelRsvp,
  getMyRsvps,
  initiateEventTicketPayment,
  renderSimulatedEventCheckout,
  completeSimulatedEventPayment,
  verifyEventTicketPayment,
} from "../controllers/eventController";

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed!"));
  },
  limits: { fileSize: 5 * 1024 * 1024 },
});

const eventRouter = Router();

eventRouter.get("/", guestAuth, getEvents);
eventRouter.get("/mine/rsvps", guestAuth, verifyToken, getMyRsvps);
// Must come before "/:id" — Express would otherwise match "admin" as an
// :id param (same reason "/mine/rsvps" above is ordered ahead of it too).
eventRouter.get("/admin/all", guestAuth, verifyToken, authorize("Admin"), getAllEventsAdmin);
// Same reasoning — literal segments must come before "/:id" or Express
// matches them as the :id param instead.
eventRouter.get("/rsvp-payment/simulate/:reference", renderSimulatedEventCheckout);
eventRouter.post("/rsvp-payment/simulate/:reference/complete", completeSimulatedEventPayment);
eventRouter.post("/rsvp-payment/verify", guestAuth, verifyToken, verifyEventTicketPayment);
eventRouter.get("/:id", guestAuth, getEventById);

eventRouter.post("/", guestAuth, verifyToken, authorize("Admin"), upload.single("bannerImage"), createEvent);
eventRouter.put("/:id", guestAuth, verifyToken, authorize("Admin"), upload.single("bannerImage"), updateEvent);
eventRouter.delete("/:id", guestAuth, verifyToken, authorize("Admin"), deleteEvent);

eventRouter.post("/:id/rsvp", guestAuth, verifyToken, rsvpToEvent);
eventRouter.delete("/:id/rsvp", guestAuth, verifyToken, cancelRsvp);
eventRouter.post("/:id/rsvp/pay", guestAuth, verifyToken, initiateEventTicketPayment);

export default eventRouter;
