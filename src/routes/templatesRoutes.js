// routes/templateRoutes.js
const express = require("express");
const router = express.Router();

const templates = require("../controllers/templatesController");

const { requireAdmin } = require("../middlewares/requireAdmin");
const { requireAuth } = require("../middlewares/requireAuth");

router.get("/public", templates.listPublicTemplates);
router.get("/public/top", templates.listTopTemplates);
router.get("/public/:id", templates.getPublicTemplate);

router.use(requireAuth);

router.get("/", templates.listTemplates);
router.get("/:id", templates.getTemplate);
router.post("/", requireAdmin, templates.createTemplate);
router.patch("/:id", requireAdmin, templates.patchTemplate);
router.delete("/:id", requireAdmin, templates.deleteTemplate);

module.exports = router;
