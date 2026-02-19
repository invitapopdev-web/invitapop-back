// controllers/templatesController.js
const { supabaseAdmin } = require("../config/supabaseClient");


function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function deepMerge(target, patch) {
  if (Array.isArray(target) && Array.isArray(patch)) return patch;
  if (!isPlainObject(target) || !isPlainObject(patch)) return patch;

  const out = { ...target };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (isPlainObject(v) && isPlainObject(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

function safeJsonParse(maybeJson) {
  if (typeof maybeJson === "string") {
    const trimmed = maybeJson.trim();
    if (!trimmed) return { ok: false, error: "design_json is empty" };
    try {
      return { ok: true, value: JSON.parse(trimmed) };
    } catch {
      return { ok: false, error: "design_json is not valid JSON" };
    }
  }
  if (typeof maybeJson === "object" && maybeJson !== null) return { ok: true, value: maybeJson };
  return { ok: false, error: "design_json must be a JSON string or object" };
}

function normalizeDesignJson(input, { maxBytes = 1_000_000 } = {}) {
  const parsed = safeJsonParse(input);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const val = parsed.value;
  const isValidRoot = isPlainObject(val) || Array.isArray(val);
  if (!isValidRoot) return { ok: false, error: "design_json root must be object or array" };

  let str;
  try {
    str = JSON.stringify(val);
  } catch {
    return { ok: false, error: "design_json is not serializable" };
  }

  const bytes = Buffer.byteLength(str, "utf8");
  if (bytes > maxBytes) return { ok: false, error: `design_json too large (${bytes} bytes)` };

  if (isPlainObject(val)) {
    if ("backgroundImageUrl" in val && typeof val.backgroundImageUrl !== "string") {
      return { ok: false, error: "backgroundImageUrl must be a string" };
    }
  }

  return { ok: true, jsonObject: val, jsonString: str };
}

function toBool(v) {
  if (v === true || v === false) return v;
  if (typeof v === "string") {
    if (v.toLowerCase() === "true") return true;
    if (v.toLowerCase() === "false") return false;
  }
  return undefined;
}

function badRequest(res, msg) {
  return res.status(400).json({ error: msg });
}

// ---------- Controllers ----------

// GET /api/templates?is_active=true&q=...
async function listTemplates(req, res, next) {
  try {
    // req.user ya existe si estás autenticado (igual que en /api/auth/me)
    if (!req.user) return res.status(401).json({ error: "No autenticado" });

    const isActive = toBool(req.query.is_active);
    const q = (req.query.q || "").toString().trim();

    let query = supabaseAdmin
      .from("templates")
      .select("*")
      .order("created_at", { ascending: false });

    if (typeof isActive === "boolean") query = query.eq("is_active", isActive);
    if (q) query = query.ilike("name", `%${q}%`);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ templates: data });
  } catch (err) {
    next(err);
  }
}

// GET /api/templates/:id
async function getTemplate(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ error: "No autenticado" });

    const { id } = req.params;

    const { data, error } = await supabaseAdmin
      .from("templates")
      .select("*")
      .eq("id", id)
      .single();

    if (error) return res.status(404).json({ error: "Template not found" });
    return res.json({ template: data });
  } catch (err) {
    next(err);
  }
}

// POST /api/templates
async function createTemplate(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ error: "No autenticado" });

    const { name, slug, thumbnail_url, is_active, design_json, top } = req.body || {};

    if (!name || typeof name !== "string") return badRequest(res, "name is required");
    if (!slug || typeof slug !== "string") return badRequest(res, "slug is required");
    if (!thumbnail_url || typeof thumbnail_url !== "string")
      return badRequest(res, "thumbnail_url is required");

    let designJsonString = null;
    if (design_json !== undefined && design_json !== null) {
      const normalized = normalizeDesignJson(design_json);
      if (!normalized.ok) return badRequest(res, normalized.error);
      designJsonString = normalized.jsonString;
    }

    const { data: existing } = await supabaseAdmin
      .from("templates")
      .select("id")
      .eq("slug", slug.trim())
      .maybeSingle();

    if (existing?.id) return res.status(409).json({ error: "slug already exists" });

    const payload = {
      name: name.trim(),
      slug: slug.trim(),
      thumbnail_url: thumbnail_url.trim(),
      is_active: typeof is_active === "boolean" ? is_active : true,
      design_json: designJsonString,
      top: typeof top === "boolean" ? top : false,
    };

    const { data, error } = await supabaseAdmin
      .from("templates")
      .insert(payload)
      .select("*")
      .single();

    if (error) return res.status(500).json({ error: error.message });

    return res.status(201).json({ template: data });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/templates/:id
async function patchTemplate(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ error: "No autenticado" });

    const { id } = req.params;
    const { name, slug, thumbnail_url, is_active, design_json, design_json_patch, top } = req.body || {};

    const { data: current, error: curErr } = await supabaseAdmin
      .from("templates")
      .select("*")
      .eq("id", id)
      .single();

    if (curErr || !current) return res.status(404).json({ error: "Template not found" });

    if (typeof slug === "string" && slug.trim() && slug.trim() !== current.slug) {
      const { data: existing } = await supabaseAdmin
        .from("templates")
        .select("id")
        .eq("slug", slug.trim())
        .maybeSingle();
      if (existing?.id) return res.status(409).json({ error: "slug already exists" });
    }

    const patchPayload = {};
    if (typeof name === "string") patchPayload.name = name.trim();
    if (typeof slug === "string") patchPayload.slug = slug.trim();
    if (typeof thumbnail_url === "string") patchPayload.thumbnail_url = thumbnail_url.trim();
    if (typeof is_active === "boolean") patchPayload.is_active = is_active;
    if (typeof top === "boolean") patchPayload.top = top;

    if (design_json !== undefined) {
      const normalized = normalizeDesignJson(design_json);
      if (!normalized.ok) return badRequest(res, normalized.error);
      patchPayload.design_json = normalized.jsonString;
    }

    if (design_json_patch !== undefined) {
      const curParsed = safeJsonParse(current.design_json || "{}");
      const patchParsed = safeJsonParse(design_json_patch);
      if (!patchParsed.ok) return badRequest(res, patchParsed.error);

      const base = curParsed.ok ? curParsed.value : {};
      const merged = deepMerge(base, patchParsed.value);

      const normalizedMerged = normalizeDesignJson(merged);
      if (!normalizedMerged.ok) return badRequest(res, normalizedMerged.error);

      patchPayload.design_json = normalizedMerged.jsonString;
    }

    if (Object.keys(patchPayload).length === 0) return badRequest(res, "No fields to update");

    const { data, error } = await supabaseAdmin
      .from("templates")
      .update(patchPayload)
      .eq("id", id)
      .select("*")
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ template: data });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/templates/:id  (soft delete)
async function deleteTemplate(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ error: "No autenticado" });

    const { id } = req.params;

    const { data, error } = await supabaseAdmin
      .from("templates")
      .update({ is_active: false })
      .eq("id", id)
      .select("*")
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ template: data, deleted: true });
  } catch (err) {
    next(err);
  }
}


// GET /api/templates/public
// GET /api/templates/public/top
async function listTopTemplates(req, res, next) {
  try {
    const { data, error } = await supabaseAdmin
      .from("templates")
      .select("id, created_at, name, slug, thumbnail_url, design_json")
      .eq("is_active", true)
      .eq("top", true)
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ templates: data });
  } catch (err) {
    next(err);
  }
}

async function listPublicTemplates(req, res, next) {
  try {
    const { data, error } = await supabaseAdmin
      .from("templates")
      .select("id, created_at, name, slug, thumbnail_url, design_json")
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ templates: data });
  } catch (err) {
    next(err);
  }
}

// GET /api/templates/public/:id
async function getPublicTemplate(req, res, next) {
  try {
    const { id } = req.params;

    const { data, error } = await supabaseAdmin
      .from("templates")
      .select("id, created_at, name, slug, thumbnail_url, design_json, is_active")
      .eq("id", id)
      .eq("is_active", true)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Template not found" });

    return res.json({ template: data });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listTemplates,
  getTemplate,
  createTemplate,
  patchTemplate,
  deleteTemplate,
  listPublicTemplates,
  getPublicTemplate,
  listTopTemplates
};
