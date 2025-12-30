const express = require("express");
const multer = require("multer");

const { requireAuth } = require("../middlewares/requireAuth");
const { requireAdmin } = require("../middlewares/requireAdmin");
const { uploadTemplateImage } = require("../controllers/templateImagesController");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post(
  "/:id/images",
  requireAuth,
  requireAdmin,
  upload.single("file"),
  uploadTemplateImage
);

module.exports = router;
