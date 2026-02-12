const { supabaseAdmin } = require("../config/supabaseClient");
const { sendTemplatedEmail } = require("../services/emailService");
const { env } = require("../config/env");

/**
 * Función interna para procesar el envío de un email a un invitado
 */
async function processEmailSend({ event, guest, invitationUrl }) {
    const variables = {
        guest_name: guest.full_name,
        event_name: event.title_text,
        event_date: event.event_date || "Por confirmar",
        event_time: event.event_time || "",
        event_location: event.location || "Por confirmar",
        invitation_url: invitationUrl,
    };

    const result = await sendTemplatedEmail({
        to: guest.email,
        subject: `Invitación a ${event.title_text}`,
        variables,
    });

    const updatePayload = {
        email_status: result.success ? "sent" : "failed",
        email_error: result.success ? null : result.error,
        email_message_id: result.success ? result.messageId : null,
    };

    await supabaseAdmin
        .from("guests")
        .update(updatePayload)
        .eq("id", guest.id);

    return result;
}

async function sendGuestInvitation(req, res, next) {
    try {
        const { eventId, guestId } = req.params;
        const userId = req.user.id;

        // 1. Validar dueño del evento
        const { data: event, error: eventErr } = await supabaseAdmin
            .from("events")
            .select("*")
            .eq("id", eventId)
            .eq("user_id", userId)
            .maybeSingle();

        if (eventErr) return res.status(500).json({ error: eventErr.message });
        if (!event) return res.status(404).json({ error: "Event not found or unauthorized" });

        // 1.1 Validar que el evento sea de tipo email
        if (!event.invitation_type?.startsWith("email")) {
            return res.status(400).json({ error: "Este evento no admite envío de invitaciones por correo electrónico." });
        }

        // 2. Obtener datos del invitado
        const { data: guest, error: guestErr } = await supabaseAdmin
            .from("guests")
            .select("*")
            .eq("id", guestId)
            .eq("event_id", eventId)
            .maybeSingle();

        if (guestErr) return res.status(500).json({ error: guestErr.message });
        if (!guest) return res.status(404).json({ error: "Guest not found" });
        if (!guest.email) return res.status(400).json({ error: "Guest has no email address" });

        // 3. Generar URL personalizada
        const invitationUrl = `${env.FRONTEND_PUBLIC_URL}/invitation/${eventId}/${guestId}`;

        // 4. Manejar balance (solo si es el primer envío exitoso Y es tipo EMAIL)
        const isFirstSend = guest.email_status !== "sent";
        const invitationType = (event.invitation_type || "").toLowerCase();
        const productType = invitationType.split(":")[0];

        if (isFirstSend && productType === "email") {
            const { data: balance, error: balErr } = await supabaseAdmin
                .from("invitation_balances")
                .select("id, total_purchased, total_used")
                .eq("user_id", userId)
                .eq("product_type", productType)
                .maybeSingle();

            if (balErr) return res.status(500).json({ error: "Error verificando saldo" });

            const purchased = balance?.total_purchased || 0;
            const used = balance?.total_used || 0;

            if (purchased - used <= 0) {
                return res.status(403).json({ error: "Saldo insuficiente para enviar invitaciones de este tipo." });
            }

            const { error: updBalErr } = await supabaseAdmin
                .from("invitation_balances")
                .update({ total_used: used + 1, updated_at: new Date().toISOString() })
                .eq("id", balance.id);

            if (updBalErr) return res.status(500).json({ error: "Error descontando saldo" });
        }

        // 5. Enviar email
        const result = await processEmailSend({ event, guest, invitationUrl });

        if (!result.success) {
            return res.status(500).json({ error: "Failed to send email", details: result.error });
        }

        return res.json({ success: true, messageId: result.messageId, invitationUrl });
    } catch (err) {
        next(err);
    }
}

async function sendAllGuestInvitations(req, res, next) {
    try {
        const { eventId } = req.params;
        const userId = req.user.id;
        const pendingOnly = req.query.pendingOnly === "true";

        // 1. Validar dueño del evento
        const { data: event, error: eventErr } = await supabaseAdmin
            .from("events")
            .select("*")
            .eq("id", eventId)
            .eq("user_id", userId)
            .maybeSingle();

        if (eventErr) return res.status(500).json({ error: eventErr.message });
        if (!event) return res.status(404).json({ error: "Event not found or unauthorized" });

        // 1.1 Validar que el evento sea de tipo email
        if (!event.invitation_type?.startsWith("email")) {
            return res.status(400).json({ error: "Este evento no admite envío masivo de invitaciones por correo electrónico." });
        }

        // 2. Obtener invitados con email válido
        const { data: allGuests, error: guestsErr } = await supabaseAdmin
            .from("guests")
            .select("*")
            .eq("event_id", eventId);

        if (guestsErr) return res.status(500).json({ error: guestsErr.message });

        let guests = (allGuests || []).filter(g => g.email && g.email.trim().length > 0);

        if (pendingOnly) {
            guests = guests.filter(g => g.email_status === "queued");
        }

        if (!guests.length) {
            return res.status(400).json({ error: pendingOnly ? "No hay invitados pendientes por enviar" : "No se encontraron invitados con email válido" });
        }

        const invitationType = (event.invitation_type || "").toLowerCase();
        const productType = invitationType.split(":")[0];

        // 3. Obtener balance actual una sola vez para comprobación previa
        let currentBalance = 0;
        let balanceId = null;
        if (productType === "email") {
            const { data: balData, error: balErr } = await supabaseAdmin
                .from("invitation_balances")
                .select("id, total_purchased, total_used")
                .eq("user_id", userId)
                .eq("product_type", productType)
                .maybeSingle();

            if (!balErr && balData) {
                currentBalance = (balData.total_purchased || 0) - (balData.total_used || 0);
                balanceId = balData.id;
            }
        }

        // 4. Procesar envíos
        const results = [];
        let totalDeducted = 0;

        for (const guest of guests) {
            const isFirstTime = guest.email_status !== "sent";
            const invitationUrl = `${env.FRONTEND_PUBLIC_URL}/invitation/${eventId}/${guest.id}`;

            // Si es tipo email y es primer envío, necesitamos saldo
            if (productType === "email" && isFirstTime) {
                if (currentBalance <= 0) {
                    results.push({ guestId: guest.id, success: false, error: "Saldo insuficiente" });
                    continue;
                }
            }

            try {
                const resSend = await processEmailSend({ event, guest, invitationUrl });
                results.push({ guestId: guest.id, success: resSend.success, error: resSend.error });

                // SI el envío fue exitoso Y era la primera vez, descontamos 1 del saldo local y DB
                if (resSend.success && isFirstTime && productType === "email" && balanceId) {
                    currentBalance--;
                    totalDeducted++;

                    // Actualizamos balance en DB (lo hacemos uno a uno para seguridad, o podrías acumular)
                    // Para evitar saturar, lo ideal sería un update al final, pero si el proceso se corta, perdemos el track.
                    // Vamos a acumular y actualizar cada 10 o al final si son pocos.
                }
            } catch (err) {
                results.push({ guestId: guest.id, success: false, error: err.message });
            }

            if (guests.length > 5) await new Promise(r => setTimeout(r, 100));
        }

        // 5. Actualizar saldo total usado en DB si hubo deducciones
        if (totalDeducted > 0 && balanceId) {
            const { data: latestBal } = await supabaseAdmin
                .from("invitation_balances")
                .select("total_used")
                .eq("id", balanceId)
                .single();

            await supabaseAdmin
                .from("invitation_balances")
                .update({ total_used: (latestBal?.total_used || 0) + totalDeducted, updated_at: new Date().toISOString() })
                .eq("id", balanceId);
        }

        const successes = results.filter(r => r.success).length;

        return res.json({
            success: true,
            total: guests.length,
            sent: successes,
            failed: guests.length - successes,
            details: results.map(r => ({ id: r.guestId, ok: r.success, err: r.error }))
        });

    } catch (err) {
        next(err);
    }
}

module.exports = { sendGuestInvitation, sendAllGuestInvitations };
