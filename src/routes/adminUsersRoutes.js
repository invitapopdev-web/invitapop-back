const express = require("express");
const router = express.Router();

const controller = require("../controllers/adminUsersController");
const { requireAuth } = require("../middlewares/requireAuth");
const { requireAdmin } = require("../middlewares/requireAdmin");

// Restricciones de seguridad a todo el router
router.use(requireAuth);
router.use(requireAdmin);

// Rutas
router.get("/", controller.listUsers);
router.post("/:id/balance", controller.updateUserBalance);

module.exports = router;
