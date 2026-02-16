// src/routes/rsvpRoutes.js
const express = require("express");
const { requireAuth } = require("../middlewares/requireAuth");
const {
  getEventRsvpTree,
  postPublicRsvp,
  postPersonalizedRsvp,
  getGuestPublic, // Importado
  patchPrivateGroup,
  patchPrivateGuest,
  deletePrivateGuest,
  deletePrivateGroup,
} = require("../controllers/rsvpController");

const router = express.Router();

// ======================
// PRIVADO (owner)
// ======================

// Listado completo por grupos con invitados + respuestas + pregunta
router.get("/events/:eventId/rsvp-tree", requireAuth, getEventRsvpTree);

// Update group
router.patch("/events/:eventId/rsvp/groups/:groupId", requireAuth, patchPrivateGroup);

// Update guest + upsert answers
router.patch("/events/:eventId/rsvp/guests/:guestId", requireAuth, patchPrivateGuest);

// Delete guest (borra answers primero)
router.delete("/events/:eventId/rsvp/guests/:guestId", requireAuth, deletePrivateGuest);

// Delete group (borra answers + guests y luego group)
router.delete("/events/:eventId/rsvp/groups/:groupId", requireAuth, deletePrivateGroup);

// ======================
// PÚBLICO (sin auth)
// ======================

router.post("/public/events/:eventId/rsvp", postPublicRsvp);
router.post("/public/events/:eventId/guests/:guestId/rsvp", postPersonalizedRsvp);
router.get("/public/events/:eventId/guests/:guestId", getGuestPublic);

module.exports = router;
