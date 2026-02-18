// src/routes/paymentRoutes.js
const express = require("express");
const { requireAuth } = require("../middlewares/requireAuth");
const { getUserPayments } = require("../controllers/paymentController");

const router = express.Router();

// GET /api/payments
router.get("/", requireAuth, getUserPayments);

module.exports = router;
