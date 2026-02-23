// src/controllers/rsvpController.js
const { supabaseAdmin } = require("../config/supabaseClient");

/**
 * Helper: valida que el evento existe y que el usuario autenticado es el dueño.
 */
async function assertEventOwner(eventId, userId) {
  const { data: event, error } = await supabaseAdmin
    .from("events")
    .select("id, user_id")
    .eq("id", eventId)
    .maybeSingle();

  if (error) return { ok: false, status: 500, error: error.message };
  if (!event) return { ok: false, status: 404, error: "Event not found" };
  if (event.user_id !== userId) return { ok: false, status: 403, error: "Forbidden" };

  return { ok: true, event };
}

/**
 * GET PRIVADO (owner):
 * Lista grupos del evento con invitados y sus respuestas + la pregunta.
 * Soporta paginación, búsqueda por nombre/email/telefono y filtro de asistencia.
 *
 * GET /api/events/:eventId/rsvp-tree?page=1&limit=30&search=...&attending=all
 */
async function getEventRsvpTree(req, res, next) {
  try {
    const { eventId } = req.params;
    const { page = 1, limit = 30, search = "", attending = "all" } = req.query;
    const userId = req.user?.id;

    const own = await assertEventOwner(eventId, userId);
    if (!own.ok) return res.status(own.status).json({ error: own.error });

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    const s = search.trim();
    const sPattern = `%${s}%`;

    // --- PASO 1: Identificar qué GRUPOS cumplen los criterios ---

    // A) IDs de grupos que machean por NOMBRE DE GRUPO
    let groupIdsByGroupName = [];
    if (s) {
      const { data: grpMatches } = await supabaseAdmin
        .from("groups")
        .select("id")
        .eq("event_id", eventId)
        .ilike("group_name", sPattern);
      groupIdsByGroupName = (grpMatches || []).map(g => g.id);
    }

    // B) IDs de grupos que machean por INVITADOS (nombre, email, tel O asistencia)
    let guestQuery = supabaseAdmin
      .from("guests")
      .select("group_id")
      .eq("event_id", eventId);

    if (attending === "yes") guestQuery = guestQuery.eq("attending", true);
    else if (attending === "no") guestQuery = guestQuery.eq("attending", false);
    else if (attending === "pending") guestQuery = guestQuery.is("attending", null);

    if (s) {
      guestQuery = guestQuery.or(`full_name.ilike.${sPattern},email.ilike.${sPattern},phone.ilike.${sPattern}`);
    }

    const { data: guestMatches, error: gMatchErr } = await guestQuery;
    if (gMatchErr) return res.status(500).json({ error: gMatchErr.message });

    const groupIdsByGuests = (guestMatches || []).map(g => g.group_id);

    // C) Combinar IDs (Operación depende de si buscamos o no)
    let finalGroupIds = [];
    if (s) {
      // Si hay búsqueda: Unión de macheos por grupo O macheos por invitado (que cumplan asistencia)
      // Pero si hay filtro de asistencia, el grupo DEBE tener al menos un invitado que cumpla ese filtro.
      // Por simplificación, tomamos los groupIds de invitados que cumplen los filtros de búsqueda/asistencia
      // Y sumamos los groupIds que machean por nombre de grupo SIEMPRE Y CUANDO esos grupos
      // tengan invitados que cumplan el filtro de asistencia (si aplica).

      if (attending !== "all") {
        // Si hay asistencia, solo valen los IDs que vinieron de la query de guests (porque esa ya filtró asistencia)
        finalGroupIds = Array.from(new Set(groupIdsByGuests));

        // Pero espera, si el grupo machea por nombre, TODOS sus invitados deberían "contar"?
        // No, el usuario espera ver el grupo solo si hay alguien asistiendo/no asistiendo según el filtro.
      } else {
        // Si no hay filtro de asistencia, es la unión simple
        finalGroupIds = Array.from(new Set([...groupIdsByGroupName, ...groupIdsByGuests]));
      }
    } else {
      // Si NO hay búsqueda, solo manda el filtro de asistencia sobre los invitados
      if (attending !== "all") {
        finalGroupIds = Array.from(new Set(groupIdsByGuests));
      } else {
        // Caso base: Sin filtros, sacamos todos los grupos del evento
        const { data: allG } = await supabaseAdmin.from("groups").select("id").eq("event_id", eventId);
        finalGroupIds = (allG || []).map(g => g.id);
      }
    }

    const totalCount = finalGroupIds.length;
    // IMPORTANTE: Mantener orden por created_at (tendremos que hacer esto en la carga final o aquí)
    // Para simplificar, obtenemos los IDs y luego los cargamos ordenados.

    // --- PASO 2: Cargar datos paginados ---
    const paginatedIds = finalGroupIds.slice(offset, offset + limitNum);

    if (paginatedIds.length === 0) {
      // Estadísticas globales rápidas
      const { data: allStats } = await supabaseAdmin.from("guests").select("attending, email, email_status").eq("event_id", eventId);
      return res.json({
        event_id: eventId,
        groups: [],
        stats: calculateGlobalStats(allStats || []),
        pagination: { totalItems: totalCount, totalPages: Math.ceil(totalCount / limitNum), currentPage: pageNum, itemsPerPage: limitNum }
      });
    }

    const { data: fullGroups, error: fetchErr } = await supabaseAdmin
      .from("groups")
      .select(`
        *,
        guests (
          *,
          answer_questions (
            id, created_at, answer, question_id,
            questions:question_id (id, label, type, options, sort_order, is_required)
          )
        )
      `)
      .in("id", paginatedIds)
      .order("created_at", { ascending: true });

    if (fetchErr) return res.status(500).json({ error: fetchErr.message });

    // Filtrado secundario en memoria para los invitados dentro de los grupos cargados
    // (Asegura que el Accordion solo muestre los invitados que machean el filtro actual)
    const formattedGroups = fullGroups.map(grp => {
      let filteredGuests = grp.guests || [];

      if (attending !== "all") {
        const want = attending === "yes" ? true : attending === "no" ? false : null;
        filteredGuests = filteredGuests.filter(g => g.attending === want);
      }

      const groupMatchesSearch = s && (grp.group_name || "").toLowerCase().includes(s.toLowerCase());
      if (s && !groupMatchesSearch) {
        filteredGuests = filteredGuests.filter(g => {
          const sl = s.toLowerCase();
          return (g.full_name || "").toLowerCase().includes(sl) ||
            (g.email || "").toLowerCase().includes(sl) ||
            (g.phone || "").toLowerCase().includes(sl);
        });
      }

      return {
        ...grp,
        guests: filteredGuests.map(guest => ({
          ...guest,
          answers: (guest.answer_questions || []).map(aq => ({
            id: aq.id,
            created_at: aq.created_at,
            question_id: aq.question_id,
            answer: aq.answer,
            question: aq.questions || null
          }))
        }))
      };
    }).filter(g => g.guests.length > 0);

    // Estadísticas globales para los contadores superiores
    const { data: allStats } = await supabaseAdmin.from("guests").select("attending, email, email_status").eq("event_id", eventId);

    return res.json({
      event_id: eventId,
      groups: formattedGroups,
      stats: calculateGlobalStats(allStats || []),
      pagination: {
        totalItems: totalCount,
        totalPages: Math.ceil(totalCount / limitNum),
        currentPage: pageNum,
        itemsPerPage: limitNum
      }
    });
  } catch (err) {
    next(err);
  }
}

function calculateGlobalStats(allStats) {
  return {
    total: allStats.length,
    yes: allStats.filter(g => g.attending === true).length,
    no: allStats.filter(g => g.attending === false).length,
    pending: allStats.filter(g => g.attending === null).length,
    withEmail: allStats.filter(g => g.email?.trim()).length,
    queued: allStats.filter(g => g.email?.trim() && (g.email_status === "queued" || !g.email_status)).length,
    sent: allStats.filter(g => g.email?.trim() && g.email_status === "sent").length
  };
}

/**
 * POST PÚBLICO:
 * Cualquiera con la URL puede crear RSVP:
 * - crea group
 * - crea guests
 * - upsert answer_questions (por UNIQUE guest_id,question_id)
 *
 * POST /api/public/events/:eventId/rsvp
 *
 * Body:
 * {
 *   group: { group_name, contact_email, contact_phone },
 *   guests: [
 *     {
 *       full_name, email, phone, attending,
 *       answers: [ { question_id, answer } ]
 *     }
 *   ]
 * }
 */
/**
 * POST PERSONALIZADO (RSVP para Email):
 * Se usa cuando ya conocemos al invitado (viene de un enlace con guestId).
 * En lugar de crear, ACTUALIZA su registro existente.
 *
 * POST /api/public/events/:eventId/guests/:guestId/rsvp
 */
async function postPersonalizedRsvp(req, res, next) {
  try {
    const { eventId, guestId } = req.params;
    const { group, guests } = req.body || {}; // Solo procesamos el primer guest del array por simplicidad en personalizado

    if (!eventId || !guestId) return res.status(400).json({ error: "Missing eventId or guestId" });
    if (!Array.isArray(guests) || guests.length === 0) {
      return res.status(400).json({ error: "guests array is required" });
    }

    const incomingGuest = guests[0]; // El invitado principal

    // 1. Verificar que el invitado existe y pertenece al evento
    const { data: existingGuest, error: guestErr } = await supabaseAdmin
      .from("guests")
      .select("*")
      .eq("id", guestId)
      .eq("event_id", eventId)
      .maybeSingle();

    if (guestErr) return res.status(500).json({ error: guestErr.message });
    if (!existingGuest) return res.status(404).json({ error: "Guest not found in this event" });

    // 2. Validar preguntas permitidas
    const { data: eventQuestions, error: qErr } = await supabaseAdmin
      .from("questions")
      .select("id")
      .eq("event_id", eventId);

    if (qErr) return res.status(500).json({ error: qErr.message });
    const allowedQuestionIds = new Set((eventQuestions || []).map((q) => q.id));

    // 3. Actualizar Grupo (opcional)
    if (group && existingGuest.group_id) {
      await supabaseAdmin
        .from("groups")
        .update({
          group_name: group.group_name || null,
          contact_email: group.contact_email || null,
          contact_phone: group.contact_phone || null,
        })
        .eq("id", existingGuest.group_id);
    }

    // 4. Actualizar Invitado
    const { data: updatedGuest, error: updErr } = await supabaseAdmin
      .from("guests")
      .update({
        full_name: incomingGuest.full_name || existingGuest.full_name,
        phone: incomingGuest.phone || existingGuest.phone,
        attending: typeof incomingGuest.attending === "boolean" ? incomingGuest.attending : existingGuest.attending,
      })
      .eq("id", guestId)
      .select("*")
      .single();

    if (updErr) return res.status(500).json({ error: updErr.message });

    // Mark as completed if it was an email invitation
    if (existingGuest.email_status) {
      await supabaseAdmin
        .from("guests")
        .update({ email_status: "completed" })
        .eq("id", guestId);
    }

    // 5. Upsert respuestas
    const ans = Array.isArray(incomingGuest.answers) ? incomingGuest.answers : [];
    const answerRows = ans
      .filter((a) => a?.question_id && allowedQuestionIds.has(a.question_id))
      .map((a) => ({
        event_id: eventId,
        group_id: existingGuest.group_id,
        guest_id: guestId,
        question_id: a.question_id,
        answer: a.answer == null ? "" : String(a.answer),
      }));

    if (answerRows.length) {
      const { error: ansErr } = await supabaseAdmin
        .from("answer_questions")
        .upsert(answerRows, { onConflict: "guest_id,question_id" });

      if (ansErr) return res.status(500).json({ error: ansErr.message });
    }

    return res.status(200).json({
      ok: true,
      message: "RSVP updated correctly",
      guest: updatedGuest,
    });
  } catch (err) {
    next(err);
  }
}

async function postPublicRsvp(req, res, next) {
  try {
    const { eventId } = req.params;
    const { group, guests } = req.body || {};

    if (!eventId) return res.status(400).json({ error: "Missing eventId" });
    if (!Array.isArray(guests) || guests.length === 0) {
      return res.status(400).json({ error: "guests must be a non-empty array" });
    }

    // Evento existe (no owner)
    const { data: event, error: eventErr } = await supabaseAdmin
      .from("events")
      .select("id, user_id, invitation_type")
      .eq("id", eventId)
      .maybeSingle();

    if (eventErr) return res.status(500).json({ error: eventErr.message });
    if (!event) return res.status(404).json({ error: "Event not found" });

    // Validar question_id pertenece al evento (anti-inyección)
    const { data: eventQuestions, error: qErr } = await supabaseAdmin
      .from("questions")
      .select("id")
      .eq("event_id", eventId);

    if (qErr) return res.status(500).json({ error: qErr.message });
    const allowedQuestionIds = new Set((eventQuestions || []).map((q) => q.id));

    // Crear group
    const groupPayload = {
      event_id: eventId,
      group_name: group?.group_name || null,
      contact_email: group?.contact_email || null,
      contact_phone: group?.contact_phone || null,
    };

    const { data: createdGroup, error: groupCreateErr } = await supabaseAdmin
      .from("groups")
      .insert(groupPayload)
      .select("*")
      .single();

    if (groupCreateErr) return res.status(500).json({ error: groupCreateErr.message });

    const invitationType = (event.invitation_type || "").toLowerCase();
    const isEmailType = invitationType.startsWith("email");

    // Crear guests (batch)
    const guestsPayload = guests.map((g) => {
      if (!g?.full_name) throw new Error("Each guest must include full_name");
      return {
        event_id: eventId,
        group_id: createdGroup.id,
        full_name: g.full_name,
        email: g.email || null,
        phone: g.phone || null,
        attending: typeof g.attending === "boolean" ? g.attending : null,
        email_status: isEmailType ? "queued" : null
      };
    });

    const { data: createdGuests, error: guestsErr } = await supabaseAdmin
      .from("guests")
      .insert(guestsPayload)
      .select("*");

    if (guestsErr) return res.status(500).json({ error: guestsErr.message });

    // Upsert answers
    const answerRows = [];
    for (let i = 0; i < createdGuests.length; i++) {
      const createdGuest = createdGuests[i];
      const incomingGuest = guests[i];
      const ans = Array.isArray(incomingGuest.answers) ? incomingGuest.answers : [];

      for (const a of ans) {
        if (!a?.question_id) continue;
        if (!allowedQuestionIds.has(a.question_id)) continue;

        answerRows.push({
          event_id: eventId,
          group_id: createdGroup.id,
          guest_id: createdGuest.id,
          question_id: a.question_id,
          answer: a.answer == null ? "" : String(a.answer),
        });
      }
    }

    let upsertedAnswers = [];
    if (answerRows.length) {
      const { data: upData, error: upErr } = await supabaseAdmin
        .from("answer_questions")
        .upsert(answerRows, { onConflict: "guest_id,question_id" })
        .select("*");

      if (upErr) return res.status(500).json({ error: upErr.message });
      upsertedAnswers = upData || [];
    }

    // Incrementar total_used en el banco de invitaciones (gasto real)
    const attendingCount = createdGuests.filter((g) => g.attending).length;
    if (attendingCount > 0) {
      const invitationType = (event.invitation_type || "").toLowerCase();

      // Solo descontamos saldo en el RSVP si es explícitamente tipo URL
      if (invitationType.startsWith("url")) {
        const productType = invitationType.split(":")[0];

        const { data: balance, error: balErr } = await supabaseAdmin
          .from("invitation_balances")
          .select("id, total_used")
          .eq("user_id", event.user_id)
          .eq("product_type", productType)
          .maybeSingle();

        if (!balErr && balance) {
          await supabaseAdmin
            .from("invitation_balances")
            .update({
              total_used: (balance.total_used || 0) + attendingCount,
              updated_at: new Date().toISOString(),
            })
            .eq("id", balance.id);
        }
      }
    }

    return res.status(201).json({
      ok: true,
      event_id: eventId,
      group: createdGroup,
      guests: createdGuests,
      answers: upsertedAnswers,
    });
  } catch (err) {
    if (String(err.message || "").includes("full_name")) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
}

/**
 * PATCH PRIVADO (owner) - GROUP
 * PATCH /api/events/:eventId/rsvp/groups/:groupId
 */
async function patchPrivateGroup(req, res, next) {
  try {
    const { eventId, groupId } = req.params;
    const userId = req.user?.id;

    const own = await assertEventOwner(eventId, userId);
    if (!own.ok) return res.status(own.status).json({ error: own.error });

    const { group_name, contact_email, contact_phone } = req.body || {};
    const patch = {};

    if (group_name !== undefined) patch.group_name = group_name || null;
    if (contact_email !== undefined) patch.contact_email = contact_email || null;
    if (contact_phone !== undefined) patch.contact_phone = contact_phone || null;

    if (!Object.keys(patch).length) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const { data: updated, error } = await supabaseAdmin
      .from("groups")
      .update(patch)
      .eq("id", groupId)
      .eq("event_id", eventId)
      .select("*")
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!updated) return res.status(404).json({ error: "Group not found" });

    return res.json({ group: updated });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH PRIVADO (owner) - GUEST + (opcional) answers
 * PATCH /api/events/:eventId/rsvp/guests/:guestId
 *
 * Body opcional:
 * {
 *   full_name?, email?, phone?, attending?, ?,
 *   answers?: [{ question_id, answer }]
 * }
 */
async function patchPrivateGuest(req, res, next) {
  try {
    const { eventId, guestId } = req.params;
    const userId = req.user?.id;

    const own = await assertEventOwner(eventId, userId);
    if (!own.ok) return res.status(own.status).json({ error: own.error });

    const { data: guest, error: gErr } = await supabaseAdmin
      .from("guests")
      .select("*")
      .eq("id", guestId)
      .eq("event_id", eventId)
      .maybeSingle();

    if (gErr) return res.status(500).json({ error: gErr.message });
    if (!guest) return res.status(404).json({ error: "Guest not found" });

    const { full_name, email, phone, attending, answers } = req.body || {};
    const patch = {};

    if (full_name !== undefined) patch.full_name = full_name;
    if (email !== undefined) patch.email = email || null;
    if (phone !== undefined) patch.phone = phone || null;
    if (attending !== undefined) patch.attending = typeof attending === "boolean" ? attending : null;


    let updatedGuest = guest;

    if (Object.keys(patch).length) {
      const { data: ug, error: upErr } = await supabaseAdmin
        .from("guests")
        .update(patch)
        .eq("id", guestId)
        .eq("event_id", eventId)
        .select("*")
        .single();

      if (upErr) return res.status(500).json({ error: upErr.message });
      updatedGuest = ug;
    }

    let upsertedAnswers = [];
    if (Array.isArray(answers)) {
      const { data: eventQuestions, error: qErr } = await supabaseAdmin
        .from("questions")
        .select("id")
        .eq("event_id", eventId);

      if (qErr) return res.status(500).json({ error: qErr.message });
      const allowed = new Set((eventQuestions || []).map((q) => q.id));

      const rows = answers
        .filter((a) => a?.question_id && allowed.has(a.question_id))
        .map((a) => ({
          event_id: eventId,
          group_id: updatedGuest.group_id,
          guest_id: updatedGuest.id,
          question_id: a.question_id,
          answer: a.answer == null ? "" : String(a.answer),
        }));

      if (rows.length) {
        const { data: upData, error: upErr } = await supabaseAdmin
          .from("answer_questions")
          .upsert(rows, { onConflict: "guest_id,question_id" })
          .select("*");

        if (upErr) return res.status(500).json({ error: upErr.message });
        upsertedAnswers = upData || [];
      }
    }

    return res.json({
      guest: updatedGuest,
      answers: upsertedAnswers,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE PRIVADO (owner) - GUEST (borra answers primero)
 * DELETE /api/events/:eventId/rsvp/guests/:guestId
 */
async function deletePrivateGuest(req, res, next) {
  try {
    const { eventId, guestId } = req.params;
    const userId = req.user?.id;

    const own = await assertEventOwner(eventId, userId);
    if (!own.ok) return res.status(own.status).json({ error: own.error });

    const { error: delAnsErr } = await supabaseAdmin
      .from("answer_questions")
      .delete()
      .eq("event_id", eventId)
      .eq("guest_id", guestId);

    if (delAnsErr) return res.status(500).json({ error: delAnsErr.message });

    const { data: deleted, error: delGuestErr } = await supabaseAdmin
      .from("guests")
      .delete()
      .eq("id", guestId)
      .eq("event_id", eventId)
      .select("*")
      .maybeSingle();

    if (delGuestErr) return res.status(500).json({ error: delGuestErr.message });
    if (!deleted) return res.status(404).json({ error: "Guest not found" });

    return res.json({ deleted: true, guest: deleted });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE PRIVADO (owner) - GROUP (borra answers+guests y luego el group)
 * DELETE /api/events/:eventId/rsvp/groups/:groupId
 */
async function deletePrivateGroup(req, res, next) {
  try {
    const { eventId, groupId } = req.params;
    const userId = req.user?.id;

    const own = await assertEventOwner(eventId, userId);
    if (!own.ok) return res.status(own.status).json({ error: own.error });

    const { data: guests, error: gErr } = await supabaseAdmin
      .from("guests")
      .select("id")
      .eq("event_id", eventId)
      .eq("group_id", groupId);

    if (gErr) return res.status(500).json({ error: gErr.message });

    const guestIds = (guests || []).map((g) => g.id);

    if (guestIds.length) {
      const { error: delAnsErr } = await supabaseAdmin
        .from("answer_questions")
        .delete()
        .eq("event_id", eventId)
        .in("guest_id", guestIds);

      if (delAnsErr) return res.status(500).json({ error: delAnsErr.message });
    }

    const { error: delGuestsErr } = await supabaseAdmin
      .from("guests")
      .delete()
      .eq("event_id", eventId)
      .eq("group_id", groupId);

    if (delGuestsErr) return res.status(500).json({ error: delGuestsErr.message });

    const { data: deletedGroup, error: delGroupErr } = await supabaseAdmin
      .from("groups")
      .delete()
      .eq("id", groupId)
      .eq("event_id", eventId)
      .select("*")
      .maybeSingle();

    if (delGroupErr) return res.status(500).json({ error: delGroupErr.message });
    if (!deletedGroup) return res.status(404).json({ error: "Group not found" });

    return res.json({ deleted: true, group: deletedGroup });
  } catch (err) {
    next(err);
  }
}

/**
 * GET PÚBLICO:
 * Obtiene datos básicos del invitado (nombre) para pre-rellenar el RSVP.
 * GET /api/public/events/:eventId/guests/:guestId
 */
async function getGuestPublic(req, res, next) {
  try {
    const { eventId, guestId } = req.params;

    // 1. Obtener tipo de invitación del evento
    const { data: event, error: evErr } = await supabaseAdmin
      .from("events")
      .select("invitation_type")
      .eq("id", eventId)
      .maybeSingle();

    if (evErr || !event) return res.status(404).json({ error: "Event not found" });

    const invType = (event.invitation_type || "").toLowerCase();

    // 2. Si el evento es tipo URL, no permitimos acceso por guestId (debe ser invitación general)
    if (invType.startsWith("url")) {
      return res.status(403).json({
        error: "Forbidden",
        message: "Esta ruta no está disponible para este tipo de evento.",
      });
    }

    const { data: guest, error } = await supabaseAdmin
      .from("guests")
      .select("id, full_name, email, phone, attending, group_id")
      .eq("id", guestId)
      .eq("event_id", eventId)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!guest) return res.status(404).json({ error: "Guest not found" });

    // 3. Obtener respuestas previas
    const { data: answers, error: ansErr } = await supabaseAdmin
      .from("answer_questions")
      .select("question_id, answer")
      .eq("guest_id", guestId);

    if (ansErr) return res.status(500).json({ error: ansErr.message });

    return res.json({
      guest: {
        ...guest,
        answers: answers || []
      }
    });
  } catch (err) {
    next(err);
  }
}

async function trackGuestOpen(req, res, next) {
  try {
    const { guestId } = req.params;

    const { data: guest, error: gErr } = await supabaseAdmin
      .from("guests")
      .select("id, email_status")
      .eq("id", guestId)
      .maybeSingle();

    if (gErr || !guest) return res.status(404).json({ error: "Guest not found" });

    // Solo pasamos a 'opened' si estaba en 'sent' o 'queued'
    if (guest.email_status === "sent" || guest.email_status === "queued") {
      await supabaseAdmin
        .from("guests")
        .update({ email_status: "opened" })
        .eq("id", guestId);

      console.log(`[Tracking] Invitado ${guestId} marcó como 'opened'`);
    }

    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getEventRsvpTree,
  postPublicRsvp,
  postPersonalizedRsvp,
  getGuestPublic, // Exportado
  trackGuestOpen,
  patchPrivateGroup,
  patchPrivateGuest,
  deletePrivateGuest,
  deletePrivateGroup,
};
