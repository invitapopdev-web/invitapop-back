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
      .eq("status", "published")
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

module.exports = {
  // público
  getEventPublic,

  // privado (dueño)
  listEvents,
  getEventPrivate,
  createEvent,
  patchEvent,
  deleteEvent,
};
