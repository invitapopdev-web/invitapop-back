// src/routes/profileRoutes.js
const express = require("express");
const { requireAuth } = require("../middlewares/requireAuth");
const { updateProfile } = require("../controllers/profileController");

const router = express.Router();

// PATCH /api/profile
router.patch("/", requireAuth, updateProfile);

module.exports = router;
