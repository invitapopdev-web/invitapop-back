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
 *
 * GET /api/events/:eventId/rsvp-tree
 */
async function getEventRsvpTree(req, res, next) {
  try {
    const { eventId } = req.params;
    const userId = req.user?.id;

    const own = await assertEventOwner(eventId, userId);
    if (!own.ok) return res.status(own.status).json({ error: own.error });

    const [
      { data: groups, error: gErr },
      { data: guests, error: guErr },
      { data: answers, error: aErr },
    ] = await Promise.all([
      supabaseAdmin
        .from("groups")
        .select("*")
        .eq("event_id", eventId)
        .order("created_at", { ascending: true }),

      supabaseAdmin
        .from("guests")
        .select("*")
        .eq("event_id", eventId)
        .order("created_at", { ascending: true }),

      supabaseAdmin
        .from("answer_questions")
        .select(`
          id,
          created_at,
          event_id,
          group_id,
          guest_id,
          question_id,
          answer,
          questions:question_id (
            id,
            created_at,
            event_id,
            label,
            type,
            options,
            sort_order,
            is_required
          )
        `)
        .eq("event_id", eventId)
        .order("created_at", { ascending: true }),
    ]);

    if (gErr) return res.status(500).json({ error: gErr.message });
    if (guErr) return res.status(500).json({ error: guErr.message });
    if (aErr) return res.status(500).json({ error: aErr.message });

    // Indexar answers por guest_id
    const answersByGuest = new Map();
    for (const row of answers || []) {
      const gid = row.guest_id;
      if (!answersByGuest.has(gid)) answersByGuest.set(gid, []);
      answersByGuest.get(gid).push({
        id: row.id,
        created_at: row.created_at,
        question_id: row.question_id,
        answer: row.answer,
        question: row.questions || null,
      });
    }

    // Indexar guests por group_id (y anexar respuestas)
    const guestsByGroup = new Map();
    for (const guest of guests || []) {
      const grpId = guest.group_id;
      if (!guestsByGroup.has(grpId)) guestsByGroup.set(grpId, []);
      guestsByGroup.get(grpId).push({
        ...guest,
        answers: answersByGuest.get(guest.id) || [],
      });
    }

    // Montar árbol final
    const tree = (groups || []).map((grp) => ({
      ...grp,
      guests: guestsByGroup.get(grp.id) || [],
    }));

    return res.json({
      event_id: eventId,
      groups: tree,
    });
  } catch (err) {
    next(err);
  }
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

    // Crear guests (batch)
    const guestsPayload = guests.map((g) => {
      if (!g?.full_name) throw new Error("Each guest must include full_name");
      return {
        event_id: eventId,
        group_id: createdGroup.id,
        full_name: g.full_name,
        email: g.email || null,
        phone: g.phone || null,
        attending: !!g.attending,

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
    if (attending !== undefined) patch.attending = !!attending;


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

    const { data: guest, error } = await supabaseAdmin
      .from("guests")
      .select("id, full_name, email, phone")
      .eq("id", guestId)
      .eq("event_id", eventId)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!guest) return res.status(404).json({ error: "Guest not found" });

    return res.json({ guest });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getEventRsvpTree,
  postPublicRsvp,
  getGuestPublic, // Exportado
  patchPrivateGroup,
  patchPrivateGuest,
  deletePrivateGuest,
  deletePrivateGroup,
};
