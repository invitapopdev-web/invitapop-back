// src/controllers/invitationBalancesController.js
const { supabaseAdmin } = require("../config/supabaseClient");

function toInt(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.trunc(x) : 0;
}

async function getMyInvitationBalances(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "No autenticado" });

    const { data, error } = await supabaseAdmin
      .from("invitation_balances")
      .select("product_type, total_purchased, total_used, updated_at")
      .eq("user_id", userId)
      .order("product_type", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    const balances = (data || []).map((row) => {
      const totalPurchased = toInt(row.total_purchased);
      const totalUsed = toInt(row.total_used);
      const available = Math.max(0, totalPurchased - totalUsed);

      return {
        product_type: row.product_type,
        total_purchased: totalPurchased,
        total_used: totalUsed,
        available,
        updated_at: row.updated_at,
      };
    });

    return res.json({ balances });
  } catch (err) {
    next(err);
  }
}

module.exports = { getMyInvitationBalances };
