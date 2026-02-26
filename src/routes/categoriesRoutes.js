// routes/categoriesRoutes.js
const express = require("express");
const multer = require("multer");
const router = express.Router();

const upload = multer({ storage: multer.memoryStorage() });

const controller = require("../controllers/categoriesController");
const { requireAuth } = require("../middlewares/requireAuth");
const { requireAdmin } = require("../middlewares/requireAdmin");

// 🔓 Público
router.get("/", controller.listCategories);
router.get("/:id", controller.getCategory);

// 🔒 Admin
// 🔒 Admin
router.post(
    "/",
    requireAuth,
    requireAdmin,
    upload.fields([
        { name: "img_pc", maxCount: 1 },
        { name: "img_mobile", maxCount: 1 }
    ]),
    controller.createCategory
);
router.patch(
    "/:id",
    requireAuth,
    requireAdmin,
    upload.fields([
        { name: "img_pc", maxCount: 1 },
        { name: "img_mobile", maxCount: 1 }
    ]),
    controller.patchCategory
);
router.delete("/:id", requireAuth, requireAdmin, controller.deleteCategory);

module.exports = router;
