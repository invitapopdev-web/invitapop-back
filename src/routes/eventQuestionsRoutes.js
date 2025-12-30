// src/routes/eventQuestionsRoutes.js
const express = require("express");
const { requireAuth } = require("../middlewares/requireAuth");
const {
  listEventQuestions,
  getEventQuestion,
  createEventQuestion,
  patchEventQuestion,
  deleteEventQuestion, 
  getPublicEventQuestionsByEventId
} = require("../controllers/eventQuestionsController");

const router = express.Router();
router.get("/public/:id", getPublicEventQuestionsByEventId);



router.use(requireAuth);

// GET /api/questions?event_id=UUID

router.get("/", listEventQuestions);

// GET /api/questions/:id
router.get("/:id", getEventQuestion);

// POST /api/questions  (body: { event_id, label, type, options })
router.post("/", createEventQuestion);

// PATCH /api/questions/:id
router.patch("/:id", patchEventQuestion);

// DELETE /api/questions/:id
router.delete("/:id", deleteEventQuestion);

module.exports = router;
