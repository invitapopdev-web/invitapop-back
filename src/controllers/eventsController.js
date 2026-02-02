// src/controllers/eventsController.js
const { supabaseAdmin } = require("../config/supabaseClient");

function pick(obj, allowed) {
  const out = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) out[key] = obj[key];
  }
  return out;
}

// Campos que permites editar por PATCH/POST (privado)
const ALLOWED_FIELDS = [
  "title_text",
  "event_date",
  "event_time",
  "location",
  "notes",
  "design_json",
  "max_guests",
  "invitation_type",
];


// Campos que expones públicamente (NO metas cosas privadas aquí)
const PUBLIC_FIELDS = [
  "id",
  "title_text",
  "event_date",
  "event_time",
  "location",
  "notes",
  "status",
  "design_json",
  "max_guests",
  "invitation_type",
];


async function listEvents(req, res, next) {
  try {
    const userId = req.user.id;

    const { data, error } = await supabaseAdmin
      .from("events")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ events: data });
  } catch (err) {
    next(err);
  }
}

async function getEventPrivate(req, res, next) {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const { data, error } = await supabaseAdmin
      .from("events")
      .select("*")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Event not found" });

    return res.json({ event: data });
  } catch (err) {
    next(err);
  }
}

/**
 * GET público:
 * - sin auth
 * - SOLO eventos publicados
 * - SOLO campos públicos
 */
async function getEventPublic(req, res, next) {
  try {
    const { id } = req.params;

    const { data, error } = await supabaseAdmin
      .from("events")
      .select(PUBLIC_FIELDS.join(","))
      .eq("id", id)
      .eq("status", "draft")
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });

    // Si no existe o no está publicado => 404 (no reveles si existe en draft)
    if (!data) return res.status(404).json({ error: "Not found" });

    return res.json({ event: data });
  } catch (err) {
    next(err);
  }
}

async function createEvent(req, res, next) {
  try {
    const userId = req.user.id;
    const body = req.body || {};

    const payload = {
      user_id: userId,
      ...pick(body, ALLOWED_FIELDS),
    };

    // permitir vacío: si no mandas nada, queda null.
    // status por defecto:
    if (payload.status === undefined) payload.status = "draft";

    const { data, error } = await supabaseAdmin
      .from("events")
      .insert(payload)
      .select("*")
      .single();

    if (error) return res.status(500).json({ error: error.message });

    return res.status(201).json({ event: data });
  } catch (err) {
    next(err);
  }
}

async function patchEvent(req, res, next) {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const body = req.body || {};
    const patch = pick(body, ALLOWED_FIELDS);

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    // si tienes updated_at en tabla, esto ayuda
    patch.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("events")
      .update(patch)
      .eq("id", id)
      .eq("user_id", userId)
      .select("*")
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Event not found" });

    return res.json({ event: data });
  } catch (err) {
    next(err);
  }
}

async function deleteEvent(req, res, next) {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const { data, error } = await supabaseAdmin
      .from("events")
      .delete()
      .eq("id", id)
      .eq("user_id", userId)
      .select("*")
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Event not found" });

    return res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
}

// ---------- Export invitados (CSV) ----------

function escCsv(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function normalizeAttending(attending) {
  if (attending === true) return "SI";
  if (attending === false) return "NO";
  return "PENDIENTE";
}

function toOptionsMap(options) {
  const map = new Map();
  (options || []).forEach((o) => {
    if (o?.id) map.set(o.id, o.label ?? o.id);
  });
  return map;
}

function parseMultiIds(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string") return [];
  const s = raw.trim();
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function humanizeAnswer(raw, q) {
  const type = q?.type || "text";

  if (type === "single_choice") {
    const optId = String(raw || "");
    if (!optId) return "";
    const map = toOptionsMap(q.options);
    return map.get(optId) || "";
  }

  if (type === "multi_choice") {
    const ids = parseMultiIds(raw);
    if (!ids.length) return "";
    const map = toOptionsMap(q.options);
    const labels = ids.map((id) => map.get(id)).filter(Boolean);
    return labels.join(", ");
  }

  if (type === "number") {
    if (raw === null || raw === undefined || raw === "") return "";
    const n = Number(raw);
    return Number.isFinite(n) ? String(n) : "";
  }

  // text (y cualquier otro)
  return raw === null || raw === undefined ? "" : String(raw);
}

/**
 * GET /api/events/:id/export?format=csv
 * Privado (dueño): exporta invitados + asistencia + respuestas (humanizadas).
 */
async function exportGuests(req, res, next) {
  try {
    const userId = req.user.id;
    const { id: eventId } = req.params;

    const format = String(req.query.format || "csv").toLowerCase();
    if (format !== "csv") {
      return res.status(400).json({ error: "Only format=csv is supported for now" });
    }

    // 1) Validar dueño del evento
    const { data: event, error: eventErr } = await supabaseAdmin
      .from("events")
      .select("id, user_id, title_text")
      .eq("id", eventId)
      .eq("user_id", userId)
      .maybeSingle();

    if (eventErr) return res.status(500).json({ error: eventErr.message });
    if (!event) return res.status(404).json({ error: "Event not found" });

    // 2) Preguntas (incluye type + options para humanizar)
    const { data: questions, error: qErr } = await supabaseAdmin
      .from("questions")
      .select("id,label,type,options,sort_order")
      .eq("event_id", eventId)
      .order("sort_order", { ascending: true });

    if (qErr) return res.status(500).json({ error: qErr.message });

    // 3) Invitados + grupo
    const { data: guests, error: gErr } = await supabaseAdmin
      .from("guests")
      .select(
        "id,created_at,event_id,group_id,full_name,email,phone,attending, groups(group_name,contact_email,contact_phone)"
      )
      .eq("event_id", eventId)
      .order("created_at", { ascending: true });

    if (gErr) return res.status(500).json({ error: gErr.message });

    // 4) Respuestas (raw) por guest_id + question_id
    const { data: answers, error: aErr } = await supabaseAdmin
      .from("answer_questions")
      .select("guest_id,question_id,answer")
      .eq("event_id", eventId);

    if (aErr) return res.status(500).json({ error: aErr.message });

    const answersByGuest = new Map();
    for (const a of answers || []) {
      if (!a?.guest_id) continue;
      if (!answersByGuest.has(a.guest_id)) answersByGuest.set(a.guest_id, new Map());
      answersByGuest.get(a.guest_id).set(a.question_id, a.answer ?? "");
    }

    // 5) CSV (sin guest_id)
    const baseHeaders = [
      "full_name",
      "email",
      "phone",
      "group_name",
      "contact_email",
      "contact_phone",
      "attending",
      "responded",
    ];

    const questionHeaders = (questions || []).map((q) => `Q: ${q.label || q.id}`);
    const headers = [...baseHeaders, ...questionHeaders];

    const lines = [];
    lines.push("\ufeff" + headers.map(escCsv).join(","));

    for (const g of guests || []) {
      const group = g.groups || null;

      const guestAnswers = answersByGuest.get(g.id) || new Map();
      const hasAnyAnswer = guestAnswers.size > 0;
      const responded = g.attending === true || g.attending === false || hasAnyAnswer;

      const baseRow = [
        g.full_name || "",
        g.email || "",
        g.phone || "",
        group?.group_name || "",
        group?.contact_email || "",
        group?.contact_phone || "",
        normalizeAttending(g.attending),
        responded ? "SI" : "NO",
      ];

      const qRow = (questions || []).map((q) => {
        const raw = guestAnswers.get(q.id);
        return humanizeAnswer(raw, q);
      });

      lines.push([...baseRow, ...qRow].map(escCsv).join(","));
    }

    const safeTitle = String(event.title_text || "evento")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9\-_.]/g, "");
    const filename = `invitados-${safeTitle || eventId}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(lines.join("\r\n"));
  } catch (err) {
    next(err);
  }
}




module.exports = {
  // público
  getEventPublic,

  // privado (dueño)
  listEvents,
  getEventPrivate,
  createEvent,
  patchEvent,
  deleteEvent,
  exportGuests
};
