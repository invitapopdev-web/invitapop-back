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

    // Enriquecer con reservas dinámicas
    const enrichedBalances = await Promise.all((bankBalances || []).map(async (bal) => {
      const { totalMaxGuests } = await getEventUsageMetrics(userId, bal.product_type);

      const purchased = toInt(bal.total_purchased);
      const usedRSVPs = toInt(bal.total_used); // Solo RSVPs confirmados
      const reserved = totalMaxGuests; // Suma de max_guests de publicados

      // Disponibles = Compradas - Reservadas
      // (Asumiendo que las RSVPs confirmadas ocurren DENTRO de un evento publicado, 
      // y si el evento se borra, las confirmadas siguen restando del banco).
      // Pero para simplificar al usuario:
      const available = Math.max(0, purchased - reserved);

      return {
        ...bal,
        total_reserved: reserved,
        available: available
      };
    }));

    return res.json({ balances: enrichedBalances });
  } catch (err) {
    next(err);
  }
}

module.exports = { getMyInvitationBalances };
