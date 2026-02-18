// src/controllers/paymentController.js
const { supabaseAdmin } = require("../config/supabaseClient");

async function getUserPayments(req, res, next) {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ error: "No autenticado" });

        const { data: payments, error } = await supabaseAdmin
            .from("invitation_purchases")
            .select("*")
            .eq("user_id", userId)
            .order("created_at", { ascending: false });

        if (error) {
            console.error("Error fetching payments:", error);
            return res.status(500).json({ error: "Error al obtener el historial de pagos" });
        }

        return res.json({ payments });
    } catch (err) {
        next(err);
    }
}

module.exports = { getUserPayments };
