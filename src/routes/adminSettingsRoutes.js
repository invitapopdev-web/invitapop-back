const express = require("express");
const router = express.Router();
const adminSettingsController = require("../controllers/adminSettingsController");
const { requireAuth } = require("../middlewares/requireAuth");
const { requireAdmin } = require("../middlewares/requireAdmin");

router.use(requireAuth);
router.use(requireAdmin);

router.get("/bonus-config", adminSettingsController.getBonusConfig);
router.patch("/bonus-config", adminSettingsController.updateBonusQty);

module.exports = router;
