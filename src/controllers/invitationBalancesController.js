// src/controllers/invitationBalancesController.js
const { supabaseAdmin } = require("../config/supabaseClient");

const { getEventUsageMetrics, getUserConfirmedRSVPs } = require("./eventsController");

function toInt(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.trunc(x) : 0;
}

async function getMyInvitationBalances(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "No autenticado" });

    const { data: bankBalances, error } = await supabaseAdmin
      .from("invitation_balances")
      .select("product_type, total_purchased, total_used, updated_at")
      .eq("user_id", userId)
      .order("product_type", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    // Enriquecer con reservas dinámicas (Consolidado)
    const { totalPurchased, totalMaxGuests } = await getEventUsageMetrics(userId);

    // El balance consumido (RSVPs) sigue siendo útil por separado si se desea, 
    // pero para el pool global sumamos total_used de todas las filas.
    const totalUsedRSVPs = (bankBalances || []).reduce((acc, b) => acc + (toInt(b.total_used)), 0);

    const available = Math.max(0, totalPurchased - totalMaxGuests);

    const consolidatedBalance = {
      product_type: "all",
      total_purchased: totalPurchased,
      total_used: totalUsedRSVPs,
      total_reserved: totalMaxGuests,
      available: available,
      updated_at: bankBalances?.[0]?.updated_at || new Date().toISOString()
    };

    return res.json({ balances: [consolidatedBalance] });
  } catch (err) {
    next(err);
  }
}

module.exports = { getMyInvitationBalances };
