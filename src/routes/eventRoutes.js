// src/routes/eventRoutes.js
const express = require("express");
const { requireAuth } = require("../middlewares/requireAuth");
const {
  getEventPublic,
  listEvents,
  getEventPrivate,
  createEvent,
  patchEvent,
  deleteEvent,
  exportGuests
} = require("../controllers/eventsController");

const router = express.Router();

/**
 * RUTAS PÚBLICAS (sin auth)
 * - OJO: solo published y solo campos públicos
 */
router.get("/public/:id", getEventPublic);

/**
 * RUTAS PRIVADAS (con auth)
 */
router.use(requireAuth);

const { sendGuestInvitation } = require("../controllers/invitationController");

router.get("/", listEvents);
router.get("/:id", getEventPrivate);
router.post("/", createEvent);
router.patch("/:id", patchEvent);
router.delete("/:id", deleteEvent);
router.get("/:id/export", exportGuests);
router.post("/:eventId/guests/:guestId/send-invitation", sendGuestInvitation);

module.exports = router;
