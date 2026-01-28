const express = require("express");
const router = express.Router();
const stripeController = require("../controllers/stripeController");

router.get("/products", stripeController.getProducts);

module.exports = router;
