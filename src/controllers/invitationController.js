const { supabaseAdmin } = require("../config/supabaseClient");
const { sendTemplatedEmail } = require("../services/emailService");
const { env } = require("../config/env");

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

        // 4. Enviar email vía Resend
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

        // 5. Actualizar estado del invitado en DB
        const updatePayload = {
            email_status: result.success ? "sent" : "failed",
            email_error: result.success ? null : result.error,
            email_message_id: result.success ? result.messageId : null,
        };

        const { error: updateErr } = await supabaseAdmin
            .from("guests")
            .update(updatePayload)
            .eq("id", guestId);

        if (updateErr) {
            console.error("Error updating guest email status:", updateErr);
            // No bloqueamos la respuesta si el correo ya se envió
        }

        if (!result.success) {
            return res.status(500).json({ error: "Failed to send email", details: result.error });
        }

        return res.json({ success: true, messageId: result.messageId, invitationUrl });
    } catch (err) {
        next(err);
    }
}

module.exports = { sendGuestInvitation };
