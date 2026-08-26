import { Router } from "express";
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
} from "../controllers/eventController";

const eventRouter = Router();

eventRouter.get("/", guestAuth, getEvents);
eventRouter.get("/mine/rsvps", guestAuth, verifyToken, getMyRsvps);
// Must come before "/:id" — Express would otherwise match "admin" as an
// :id param (same reason "/mine/rsvps" above is ordered ahead of it too).
eventRouter.get("/admin/all", guestAuth, verifyToken, authorize("Admin"), getAllEventsAdmin);
eventRouter.get("/:id", guestAuth, getEventById);

eventRouter.post("/", guestAuth, verifyToken, authorize("Admin"), createEvent);
eventRouter.put("/:id", guestAuth, verifyToken, authorize("Admin"), updateEvent);
eventRouter.delete("/:id", guestAuth, verifyToken, authorize("Admin"), deleteEvent);

eventRouter.post("/:id/rsvp", guestAuth, verifyToken, rsvpToEvent);
eventRouter.delete("/:id/rsvp", guestAuth, verifyToken, cancelRsvp);

export default eventRouter;
