// routes/categoriesRoutes.js
const express = require("express");
const router = express.Router();

const controller = require("../controllers/categoriesController");
const { requireAuth } = require("../middlewares/requireAuth");
const { requireAdmin } = require("../middlewares/requireAdmin");

// 🔓 Público
router.get("/", controller.listCategories);
router.get("/:id", controller.getCategory);

// 🔒 Admin
router.post("/", requireAuth, requireAdmin, controller.createCategory);
router.patch("/:id", requireAuth, requireAdmin, controller.patchCategory);
router.delete("/:id", requireAuth, requireAdmin, controller.deleteCategory);

module.exports = router;
