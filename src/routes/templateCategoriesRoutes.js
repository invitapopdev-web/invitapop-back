// routes/templateCategoriesRoutes.js
const express = require("express");
const router = express.Router();

const controller = require("../controllers/templateCategariesController");
const { requireAuth } = require("../middlewares/requireAuth");
const { requireAdmin } = require("../middlewares/requireAdmin");

// 🔓 Público
router.get("/", controller.getTemplateCategories);

// 🔒 Admin
router.post(
  "/",
  requireAuth,
  requireAdmin,
  controller.createTemplateCategories
);

router.put(
  "/:template_id",
  requireAuth,
  requireAdmin,
  controller.replaceTemplateCategories
);

module.exports = router;
