// src/controllers/eventQuestionsController.js
const { supabaseAdmin } = require("../config/supabaseClient");

function pick(obj, allowed) {
  const out = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) out[key] = obj[key];
  }
  return out;
}

const ALLOWED_FIELDS = ["label", "type", "options", "is_required", "sort_order"];

async function assertEventOwner({ eventId, userId }) {
  const { data, error } = await supabaseAdmin
    .from("events")
    .select("id")
    .eq("id", eventId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return { ok: false, status: 500, error: error.message };
  if (!data) return { ok: false, status: 404, error: "Event not found" };
  return { ok: true };
}

/**
 * LIST
 * - Opción plana: GET /api/event-questions?event_id=...
 * - Opción anidada: GET /api/events/:eventId/questions  (si usas mergeParams)
 */
async function listEventQuestions(req, res, next) {
  try {
    const userId = req.user.id;

    const eventId = req.params.eventId || req.query.event_id;
    if (!eventId) {
      return res.status(400).json({ error: "event_id is required" });
    }

    const owns = await assertEventOwner({ eventId, userId });
    if (!owns.ok) return res.status(owns.status).json({ error: owns.error });

    const { data, error } = await supabaseAdmin
      .from("questions")
      .select("*")
      .eq("event_id", eventId)
      .order("created_at", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    res.json({ questions: data });
  } catch (err) {
    next(err);
  }
}

/**
 * GET ONE
 * - GET /api/event-questions/:id
 * (verifica que el evento dueño coincide)
 */
async function getEventQuestion(req, res, next) {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const { data, error } = await supabaseAdmin
      .from("questions")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Question not found" });

    const owns = await assertEventOwner({ eventId: data.event_id, userId });
    if (!owns.ok) return res.status(owns.status).json({ error: owns.error });

    res.json({ question: data });
  } catch (err) {
    next(err);
  }
}

/**
 * CREATE
 * - POST /api/event-questions
 * body: { event_id, label, type, options, is_required?, sort_order? }
 */
async function createEventQuestion(req, res, next) {
  try {
    const userId = req.user.id;
    const body = req.body || {};

    const eventId = body.event_id || req.params.eventId;
    if (!eventId) {
      return res.status(400).json({ error: "event_id is required" });
    }

    const owns = await assertEventOwner({ eventId, userId });
    if (!owns.ok) return res.status(owns.status).json({ error: owns.error });

    const payload = {
      event_id: eventId,
      ...pick(body, ALLOWED_FIELDS),
    };

    if (!payload.label || !payload.type) {
      return res.status(400).json({ error: "label and type are required" });
    }

    const { data, error } = await supabaseAdmin
      .from("questions")
      .insert(payload)
      .select("*")
      .single();

    if (error) return res.status(500).json({ error: error.message });

    res.status(201).json({ question: data });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH
 * - PATCH /api/event-questions/:id
 */
async function patchEventQuestion(req, res, next) {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const body = req.body || {};

    const patch = pick(body, ALLOWED_FIELDS);
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    // Traemos la pregunta para validar ownership
    const { data: current, error: curErr } = await supabaseAdmin
      .from("questions")
      .select("id, event_id")
      .eq("id", id)
      .maybeSingle();

    if (curErr) return res.status(500).json({ error: curErr.message });
    if (!current) return res.status(404).json({ error: "Question not found" });

    const owns = await assertEventOwner({ eventId: current.event_id, userId });
    if (!owns.ok) return res.status(owns.status).json({ error: owns.error });

    const { data, error } = await supabaseAdmin
      .from("questions")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();

    if (error) return res.status(500).json({ error: error.message });

    res.json({ question: data });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE
 * - DELETE /api/event-questions/:id
 */
async function deleteEventQuestion(req, res, next) {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // ownership check
    const { data: current, error: curErr } = await supabaseAdmin
      .from("questions")
      .select("id, event_id")
      .eq("id", id)
      .maybeSingle();

    if (curErr) return res.status(500).json({ error: curErr.message });
    if (!current) return res.status(404).json({ error: "Question not found" });

    const owns = await assertEventOwner({ eventId: current.event_id, userId });
    if (!owns.ok) return res.status(owns.status).json({ error: owns.error });

    const { error } = await supabaseAdmin
      .from("questions")
      .delete()
      .eq("id", id);

    if (error) return res.status(500).json({ error: error.message });

    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listEventQuestions,
  getEventQuestion,
  createEventQuestion,
  patchEventQuestion,
  deleteEventQuestion,
};
