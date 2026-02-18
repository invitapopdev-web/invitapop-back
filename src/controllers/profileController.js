// src/controllers/profileController.js
const { supabaseAdmin } = require("../config/supabaseClient");

async function updateProfile(req, res, next) {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ error: "No autenticado" });

        const { first_name, last_name, phone } = req.body;

        // Solo permitimos actualizar estos 3 campos
        const updateData = {};
        if (first_name !== undefined) updateData.first_name = first_name;
        if (last_name !== undefined) updateData.last_name = last_name;
        if (phone !== undefined) updateData.phone = phone;

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ error: "No hay datos para actualizar" });
        }

        const { data, error } = await supabaseAdmin
            .from("profiles")
            .update(updateData)
            .eq("id", userId)
            .select()
            .maybeSingle();

        if (error) {
            console.error("Error updating profile:", error);
            return res.status(500).json({ error: "Error al actualizar el perfil" });
        }

        return res.json({ profile: data });
    } catch (err) {
        next(err);
    }
}

module.exports = { updateProfile };
