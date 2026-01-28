// src/routes/invitationBalancesRoutes.js
const express = require("express");
const { requireAuth } = require("../middlewares/requireAuth");
const {
  getMyInvitationBalances,
} = require("../controllers/invitationBalancesController");

const router = express.Router();

// GET /api/invitation-balances
router.get("/", requireAuth, getMyInvitationBalances);

module.exports = router;
