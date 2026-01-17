// routes/templateRoutes.js
const express = require("express");
const router = express.Router();

const templates = require("../controllers/templatesController");

// ✅ IMPORTA AQUÍ TU MIDDLEWARE REAL QUE PONE req.user
// Ejemplo típico: const { requireAuth } = require("../middlewares/authMiddleware");
const { requireAuth } = require("../middlewares/requireAuth");

router.get("/public", templates.listPublicTemplates);
router.get("/public/:id", templates.getPublicTemplate);

router.use(requireAuth);

router.get("/", templates.listTemplates);
router.get("/:id", templates.getTemplate);
router.post("/", templates.createTemplate);
router.patch("/:id", templates.patchTemplate);
router.delete("/:id", templates.deleteTemplate);

module.exports = router;
