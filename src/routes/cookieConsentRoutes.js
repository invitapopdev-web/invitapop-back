const express = require("express");
const router = express.Router();
const cookieConsentController = require("../controllers/cookieConsentController");

router.post("/cookie-consent", cookieConsentController.registerConsent);

module.exports = router;
