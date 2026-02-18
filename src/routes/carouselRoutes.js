const express = require("express");
const multer = require("multer");
const { requireAuth } = require("../middlewares/requireAuth");
const { requireAdmin } = require("../middlewares/requireAdmin");
const carouselController = require("../controllers/carouselController");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Public route for landing page
router.get("/", carouselController.listSlides);

// Admin routes
router.post(
    "/",
    requireAuth,
    requireAdmin,
    upload.fields([
        { name: "pcImage", maxCount: 1 },
        { name: "mobileImage", maxCount: 1 }
    ]),
    carouselController.createSlide
);

router.patch(
    "/:id",
    requireAuth,
    requireAdmin,
    upload.fields([
        { name: "pcImage", maxCount: 1 },
        { name: "mobileImage", maxCount: 1 }
    ]),
    carouselController.updateSlide
);

router.delete(
    "/:id",
    requireAuth,
    requireAdmin,
    carouselController.deleteSlide
);

module.exports = router;
