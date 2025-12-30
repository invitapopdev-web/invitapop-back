const express = require("express");
const { register, login, me, forgotPassword,
    resetPassword, logout} = require("../controllers/authController");
const { requireAuth } = require("../middlewares/requireAuth");

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.get("/me", requireAuth, me);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.post("/logout", logout);

module.exports = router;
