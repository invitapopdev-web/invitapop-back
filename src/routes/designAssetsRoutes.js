const express = require("express");

const controller = require("../controllers/designAssetsController");
const { requireAuth } = require("../middlewares/requireAuth");

const router = express.Router();

router.get("/", requireAuth, controller.listDesignAssets);

module.exports = router;
