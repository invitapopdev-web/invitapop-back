const { supabaseAdmin } = require("../config/supabaseClient");

async function requireAdmin(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });

    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("role_id, roles!inner(name)")
      .eq("id", userId)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(403).json({ error: "Profile not found" });

    if (data.roles.name !== "admin") {
      return res.status(403).json({ error: "Admin only" });
    }

    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAdmin };
