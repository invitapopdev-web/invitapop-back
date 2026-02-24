// src/routes/eventRoutes.js
const express = require("express");
const multer = require("multer");
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
const { uploadEventImage } = require("../controllers/eventImagesController");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * RUTAS PÚBLICAS (sin auth)
 * - OJO: solo published y solo campos públicos
 */
router.get("/public/:id", getEventPublic);

/**
 * RUTAS PRIVADAS (con auth)
 */
router.use(requireAuth);

const { sendGuestInvitation, sendAllGuestInvitations } = require("../controllers/invitationController");

router.get("/", listEvents);
router.get("/:id", getEventPrivate);
router.post("/", createEvent);
router.patch("/:id", patchEvent);
router.delete("/:id", deleteEvent);
router.get("/:id/export", exportGuests);
router.post("/:id/images", upload.single("file"), uploadEventImage);
router.post("/:eventId/guests/:guestId/send-invitation", sendGuestInvitation);
router.post("/:eventId/send-all-invitations", sendAllGuestInvitations);

module.exports = router;
