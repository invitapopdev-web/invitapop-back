const { supabaseAdmin } = require("../config/supabaseClient");

async function getBonusConfig(req, res, next) {
    try {
        const { data, error } = await supabaseAdmin
            .from('settings')
            .select('value, description, is_active')
            .eq('key', 'invitation_bonus_config')
            .maybeSingle();

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        if (!data) {
            return res.status(404).json({ error: "Configuración no encontrada" });
        }

        let configValue = {};
        try {
            configValue = JSON.parse(data.value);
        } catch (parseErr) {
            console.error("Error parsing invitation_bonus_config:", parseErr);
            return res.status(500).json({ error: "Error de formato en la configuración" });
        }

        return res.json({
            key: 'invitation_bonus_config',
            value: configValue,
            description: data.description,
            is_active: data.is_active
        });
    } catch (err) {
        next(err);
    }
}

async function updateBonusQty(req, res, next) {
    try {
        const { qty } = req.body;

        if (qty === undefined || qty === null || isNaN(parseInt(qty, 10))) {
            return res.status(400).json({ error: "La cantidad (qty) debe ser un número válido" });
        }

        // Primero obtenemos la configuración actual para no sobreescribir otros campos del JSON si los hubiera
        const { data: current, error: fetchError } = await supabaseAdmin
            .from('settings')
            .select('value')
            .eq('key', 'invitation_bonus_config')
            .maybeSingle();

        if (fetchError) return res.status(500).json({ error: fetchError.message });

        let newConfig = {
            signup_bonus: {
                enabled: true,
                qty: parseInt(qty, 10)
            }
        };

        if (current && current.value) {
            try {
                const parsed = JSON.parse(current.value);
                newConfig = {
                    ...parsed,
                    signup_bonus: {
                        ...(parsed.signup_bonus || {}),
                        enabled: true,
                        qty: parseInt(qty, 10)
                    }
                };
            } catch (e) {
                // Si falla el parseo usamos el default de arriba
            }
        }

        const { error: updateError } = await supabaseAdmin
            .from('settings')
            .update({
                value: JSON.stringify(newConfig)
            })
            .eq('key', 'invitation_bonus_config');

        if (updateError) {
            return res.status(500).json({ error: updateError.message });
        }

        return res.json({ message: "Configuración actualizada correctamente", config: newConfig });
    } catch (err) {
        next(err);
    }
}

module.exports = {
    getBonusConfig,
    updateBonusQty
};
