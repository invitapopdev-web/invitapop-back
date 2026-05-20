const express = require("express");
const multer = require("multer");

const controller = require("../controllers/designAssetsController");
const { requireAuth } = require("../middlewares/requireAuth");
const { requireAdmin } = require("../middlewares/requireAdmin");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(requireAuth);
router.use(requireAdmin);

router.get("/", controller.listAdminDesignAssets);
router.post("/", upload.single("file"), controller.createDesignAsset);
router.patch("/:id", controller.patchDesignAsset);
router.delete("/:id", controller.deleteDesignAsset);

module.exports = router;
