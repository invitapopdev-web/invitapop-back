// src/routes/paymentRoutes.js
const express = require("express");
const { requireAuth } = require("../middlewares/requireAuth");
const { getUserPayments, requestInvoice } = require("../controllers/paymentController");

const router = express.Router();

// GET /api/payments
router.get("/", requireAuth, getUserPayments);

// POST /api/payments/invoice
router.post("/invoice", requireAuth, requestInvoice);

module.exports = router;
