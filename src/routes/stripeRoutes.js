const express = require("express");
const router = express.Router();
const stripeController = require("../controllers/stripeController");
const { requireAuth } = require("../middlewares/requireAuth");

router.get("/products", stripeController.getProducts);
router.post("/create-checkout-session", requireAuth, stripeController.createCheckoutSession);

// Note: webhook needs raw body, handled in index.js
router.post("/webhook", stripeController.webhookHandler);

module.exports = router;
