const { supabaseAdmin } = require("../config/supabaseClient");

async function requireAuth(req, res, next) {
  const cookieToken = req.cookies?.access_token || null;

  const authHeader = req.headers.authorization || "";
  const headerToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  const token = cookieToken || headerToken;

  if (!token) {
    return res.status(401).json({ error: "Missing auth token" });
  }

  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  req.user = user;
  next();
}

module.exports = { requireAuth };
