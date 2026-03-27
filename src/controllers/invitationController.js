const { supabaseAdmin } = require("../config/supabaseClient");
const { sendTemplatedEmail } = require("../services/emailService");
const { env } = require("../config/env");

const BULK_EMAIL_LOCK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutos

function isBulkLockActive(bulkEmailStartedAt) {
    if (!bulkEmailStartedAt) return false;

    const startedAtMs = new Date(bulkEmailStartedAt).getTime();
    if (Number.isNaN(startedAtMs)) return false;

    return Date.now() - startedAtMs < BULK_EMAIL_LOCK_TIMEOUT_MS;
}

async function consumeInvitationBalance(userId) {
    const { data: balance, error: balErr } = await supabaseAdmin
        .from("invitation_balances")
        .select("id, total_purchased, total_used")
        .eq("user_id", userId)
        .maybeSingle();

    if (balErr) {
        return { success: false, error: "Error verificando saldo" };
    }

    const purchased = balance?.total_purchased || 0;
    const used = balance?.total_used || 0;

    if (!balance?.id || purchased - used <= 0) {
        return { success: false, error: "Saldo insuficiente para enviar invitaciones de este tipo." };
    }

    const { error: updBalErr } = await supabaseAdmin
        .from("invitation_balances")
        .update({
            total_used: used + 1,
            updated_at: new Date().toISOString(),
        })
        .eq("id", balance.id);

    if (updBalErr) {
        return { success: false, error: "Error descontando saldo" };
    }

    return { success: true };
}

async function acquireBulkEmailLock(event) {
    const nowIso = new Date().toISOString();

    if (isBulkLockActive(event.bulk_email_started_at)) {
        return { success: false, error: "Ya hay un envío masivo en progreso para este evento." };
    }

    let query = supabaseAdmin
        .from("events")
        .update({ bulk_email_started_at: nowIso })
        .eq("id", event.id)
        .eq("user_id", event.user_id)
        .select("id, bulk_email_started_at")
        .maybeSingle();

    if (event.bulk_email_started_at) {
        query = query.eq("bulk_email_started_at", event.bulk_email_started_at);
    } else {
        query = query.is("bulk_email_started_at", null);
    }

    const { data, error } = await query;

    if (error) {
        return { success: false, error: "Error bloqueando el envío masivo." };
    }

    if (!data) {
        return { success: false, error: "Ya hay un envío masivo en progreso para este evento." };
    }

    return { success: true, lockValue: nowIso };
}

async function releaseBulkEmailLock(eventId, userId, lockValue) {
    let query = supabaseAdmin
        .from("events")
        .update({ bulk_email_started_at: null })
        .eq("id", eventId)
        .eq("user_id", userId);

    if (lockValue) {
        query = query.eq("bulk_email_started_at", lockValue);
    }

    await query;
}

/**
 * Función interna para procesar el envío de un email a un invitado
 */

function formatDuration(startTime, endTime) {
    if (!startTime || !endTime) return "";

    const [startHour, startMinute] = startTime.split(":").map(Number);
    const [endHour, endMinute] = endTime.split(":").map(Number);

    const startTotalMinutes = startHour * 60 + startMinute;
    const endTotalMinutes = endHour * 60 + endMinute;

    const diffMinutes = endTotalMinutes - startTotalMinutes;

    if (diffMinutes <= 0) return "";

    const hours = Math.floor(diffMinutes / 60);
    const minutes = diffMinutes % 60;

    return `${hours}:${String(minutes).padStart(2, "0")}`;
}


async function processEmailSend({ event, guest, invitationUrl, emailHost }) {
    const eventDuration = formatDuration(event.event_time, event.event_time_end);

    const variables = {
        email_host: emailHost,
        guest_name: guest.full_name,
        event_name: event.title_text,
        event_date: event.event_date || "Por confirmar",
        event_time: event.event_time || "",
        event_time_end: event.event_time_end || "",
        event_duration: eventDuration,
        event_location: event.location || "Por confirmar",
        invitation_url: invitationUrl,
        google_maps_url: event.location
            ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`
            : "",
        google_calendar_url:
            event.event_date && event.event_time && event.event_time_end
                ? `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(event.title_text || "")}&dates=${encodeURIComponent(
                    `${event.event_date.replace(/-/g, "")}T${event.event_time.replace(/:/g, "").slice(0, 4)}00/${event.event_date.replace(/-/g, "")}T${event.event_time_end.replace(/:/g, "").slice(0, 4)}00`
                )}&location=${encodeURIComponent(event.location || "")}`
                : ""
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
        const emailHost = req.user.email;


        // 1. Validar dueño del evento
        const { data: event, error: eventErr } = await supabaseAdmin
            .from("events")
            .select("*")
            .eq("id", eventId)
            .eq("user_id", userId)
            .maybeSingle();

        if (eventErr) return res.status(500).json({ error: eventErr.message });
        if (!event) return res.status(404).json({ error: "Event not found or unauthorized" });

        // 1.1 Bloquear envío individual si hay masivo en curso
        if (isBulkLockActive(event.bulk_email_started_at)) {
            return res.status(409).json({
                error: "Hay un envío masivo en curso para este evento. Inténtalo de nuevo cuando termine.",
            });
        }

        // 1.2 Validar que el evento sea de tipo email
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

        // 4. Manejar balance
        const isFirstSend = guest.email_status === "queued";
        const invitationType = (event.invitation_type || "").toLowerCase();
        const productType = invitationType.split(":")[0];

        if (isFirstSend && productType === "email") {
            const balanceResult = await consumeInvitationBalance(userId);

            if (!balanceResult.success) {
                const statusCode = balanceResult.error.includes("insuficiente") ? 403 : 500;
                return res.status(statusCode).json({ error: balanceResult.error });
            }
        }
        // 5. Enviar email
        const result = await processEmailSend({ event, guest, invitationUrl, emailHost });

        if (!result.success) {
            return res.status(500).json({ error: "Failed to send email", details: result.error });
        }

        return res.json({ success: true, messageId: result.messageId, invitationUrl });
    } catch (err) {
        next(err);
    }
}

async function sendAllGuestInvitations(req, res, next) {
    let lockValue = null;

    try {
        const { eventId } = req.params;
        const userId = req.user.id;
        const emailHost = req.user.email;

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

        // 1.2 Bloquear envío masivo simultáneo
        const lockResult = await acquireBulkEmailLock(event);
        if (!lockResult.success) {
            return res.status(409).json({ error: lockResult.error });
        }

        lockValue = lockResult.lockValue;

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
            return res.status(400).json({
                error: pendingOnly
                    ? "No hay invitados pendientes por enviar"
                    : "No se encontraron invitados con email válido",
            });
        }

        const invitationType = (event.invitation_type || "").toLowerCase();
        const productType = invitationType.split(":")[0];

        // 3. Procesar envíos
        const results = [];

        for (const guest of guests) {
            const isFirstTime = guest.email_status === "queued";
            const invitationUrl = `${env.FRONTEND_PUBLIC_URL}/invitation/${eventId}/${guest.id}`;

            if (productType === "email" && isFirstTime) {
                const balanceResult = await consumeInvitationBalance(userId);

                if (!balanceResult.success) {
                    results.push({
                        guestId: guest.id,
                        success: false,
                        error: balanceResult.error,
                    });
                    continue;
                }
            }

            try {
                const resSend = await processEmailSend({ event, guest, invitationUrl, emailHost });

                results.push({
                    guestId: guest.id,
                    success: resSend.success,
                    error: resSend.error || null,
                });
            } catch (err) {
                results.push({
                    guestId: guest.id,
                    success: false,
                    error: err.message,
                });
            }

            if (guests.length > 5) {
                await new Promise(r => setTimeout(r, 100));
            }
        }

        const successes = results.filter(r => r.success).length;

        return res.json({
            success: true,
            total: guests.length,
            sent: successes,
            failed: guests.length - successes,
            details: results.map(r => ({
                id: r.guestId,
                ok: r.success,
                err: r.error,
            })),
        });
    } catch (err) {
        next(err);
    } finally {
        if (lockValue) {
            await releaseBulkEmailLock(req.params.eventId, req.user.id, lockValue);
        }
    }
}

module.exports = { sendGuestInvitation, sendAllGuestInvitations };