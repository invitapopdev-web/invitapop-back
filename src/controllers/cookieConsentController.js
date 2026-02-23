const { supabaseAdmin } = require("../config/supabaseClient");
const { env } = require("../config/env");
const crypto = require("crypto");

/**
 * Registra un consentimiento de cookies en Supabase.
 */
const registerConsent = async (req, res) => {
    try {
        const { consent_id, consent_version, cookies_policy_version, consent_settings } = req.body;

        if (!consent_id || !consent_version) {
            return res.status(400).json({ success: false, error: "Missing required fields" });
        }

        // 1. Obtener User Agent
        const user_agent = req.headers["user-agent"] || "unknown";

        // 2. Obtener IP del cliente
        const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
            req.headers["x-real-ip"] ||
            req.socket.remoteAddress ||
            "0.0.0.0";

        // 3. Generar IP Hash
        const ip_hash = crypto
            .createHash("sha256")
            .update(ip + env.CONSENT_IP_HASH_PEPPER)
            .digest("hex");

        // 4. Insertar en Supabase
        const { error } = await supabaseAdmin
            .from("cookie_consents")
            .insert({
                consent_id,
                consent_version,
                cookies_policy_version,
                consent_settings,
                ip_hash,
                user_agent
            });

        if (error) {
            console.error("Supabase insert error:", error);
            // Devolvemos el error real para debugging
            return res.status(500).json({ success: false, error: error.message, details: error });
        }

        return res.json({ success: true });

    } catch (error) {
        console.error("Cookie consent controller error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
};

module.exports = {
    registerConsent
};
