// controllers/categoriesController.js
const { supabaseAdmin } = require("../config/supabaseClient");

function badRequest(res, msg) {
  return res.status(400).json({ error: msg });
}

function isUuid(v) {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function normalizeParentId(parent_id) {
  if (parent_id === undefined) return undefined; // no tocar
  if (parent_id === null) return null; // categoría raíz
  if (typeof parent_id === "string" && parent_id.trim() === "") return null;
  if (!isUuid(parent_id)) return "__INVALID__";
  return parent_id;
}

// -------------------------
// GET (PÚBLICO) /api/categories
// Opcional: ?parent_id=null|UUID  (filtrar por raíz o por padre)
// -------------------------
async function listCategories(req, res, next) {
  try {
    const { parent_id } = req.query;

    let query = supabaseAdmin
      .from("categories")
      .select("id, created_at, name, slug, parent_id")
      .order("created_at", { ascending: false });

    if (parent_id !== undefined) {
      if (parent_id === "null") query = query.is("parent_id", null);
      else query = query.eq("parent_id", parent_id);
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ categories: data });
  } catch (err) {
    next(err);
  }
}

// -------------------------
// GET (PÚBLICO) /api/categories/:id
// -------------------------
async function getCategory(req, res, next) {
  try {
    const { id } = req.params;

    const { data, error } = await supabaseAdmin
      .from("categories")
      .select("id, created_at, name, slug, parent_id")
      .eq("id", id)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Category not found" });

    return res.json({ category: data });
  } catch (err) {
    next(err);
  }
}

// -------------------------
// POST (ADMIN) /api/categories
// body: { name, slug, parent_id? }
// -------------------------
async function createCategory(req, res, next) {
  try {
    const { name, slug, parent_id } = req.body || {};

    if (!name || typeof name !== "string") return badRequest(res, "name is required");
    if (!slug || typeof slug !== "string") return badRequest(res, "slug is required");

    const normalizedParent = normalizeParentId(parent_id);
    if (normalizedParent === "__INVALID__") return badRequest(res, "parent_id must be UUID or null");

    // slug único (si tu DB ya tiene unique, esto igual te ayuda a dar error bonito)
    const { data: existing, error: exErr } = await supabaseAdmin
      .from("categories")
      .select("id")
      .eq("slug", slug.trim())
      .maybeSingle();

    if (exErr) return res.status(500).json({ error: exErr.message });
    if (existing?.id) return res.status(409).json({ error: "slug already exists" });

    // si parent_id viene, valida que exista
    if (normalizedParent && isUuid(normalizedParent)) {
      const { data: parent, error: pErr } = await supabaseAdmin
        .from("categories")
        .select("id")
        .eq("id", normalizedParent)
        .maybeSingle();

      if (pErr) return res.status(500).json({ error: pErr.message });
      if (!parent) return res.status(400).json({ error: "parent_id not found" });
    }

    const payload = {
      name: name.trim(),
      slug: slug.trim(),
      parent_id: normalizedParent === undefined ? null : normalizedParent,
    };

    const { data, error } = await supabaseAdmin
      .from("categories")
      .insert(payload)
      .select("id, created_at, name, slug, parent_id")
      .single();

    if (error) return res.status(500).json({ error: error.message });

    return res.status(201).json({ category: data });
  } catch (err) {
    next(err);
  }
}

// -------------------------
// PATCH (ADMIN) /api/categories/:id
// body: { name?, slug?, parent_id? }
// -------------------------
async function patchCategory(req, res, next) {
  try {
    const { id } = req.params;
    const { name, slug, parent_id } = req.body || {};

    const { data: current, error: curErr } = await supabaseAdmin
      .from("categories")
      .select("id, name, slug, parent_id")
      .eq("id", id)
      .maybeSingle();

    if (curErr) return res.status(500).json({ error: curErr.message });
    if (!current) return res.status(404).json({ error: "Category not found" });

    const patch = {};

    if (name !== undefined) {
      if (!name || typeof name !== "string") return badRequest(res, "name must be a non-empty string");
      patch.name = name.trim();
    }

    if (slug !== undefined) {
      if (!slug || typeof slug !== "string") return badRequest(res, "slug must be a non-empty string");

      const nextSlug = slug.trim();
      if (nextSlug !== current.slug) {
        const { data: existing, error: exErr } = await supabaseAdmin
          .from("categories")
          .select("id")
          .eq("slug", nextSlug)
          .maybeSingle();

        if (exErr) return res.status(500).json({ error: exErr.message });
        if (existing?.id) return res.status(409).json({ error: "slug already exists" });
      }

      patch.slug = nextSlug;
    }

    if (parent_id !== undefined) {
      const normalizedParent = normalizeParentId(parent_id);
      if (normalizedParent === "__INVALID__") return badRequest(res, "parent_id must be UUID or null");

      // no puede ser su propio padre
      if (normalizedParent && normalizedParent === id) {
        return badRequest(res, "parent_id cannot be the same category id");
      }

      // valida que exista el padre si viene UUID
      if (normalizedParent && isUuid(normalizedParent)) {
        const { data: parent, error: pErr } = await supabaseAdmin
          .from("categories")
          .select("id")
          .eq("id", normalizedParent)
          .maybeSingle();

        if (pErr) return res.status(500).json({ error: pErr.message });
        if (!parent) return res.status(400).json({ error: "parent_id not found" });
      }

      patch.parent_id = normalizedParent;
    }

    if (Object.keys(patch).length === 0) {
      return badRequest(res, "No fields to update");
    }

    const { data, error } = await supabaseAdmin
      .from("categories")
      .update(patch)
      .eq("id", id)
      .select("id, created_at, name, slug, parent_id")
      .single();

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ category: data });
  } catch (err) {
    next(err);
  }
}

// -------------------------
// DELETE (ADMIN) /api/categories/:id
// Regla práctica: no borrar si tiene hijos o está usada en template_categories
// -------------------------
async function deleteCategory(req, res, next) {
  try {
    const { id } = req.params;

    // existe?
    const { data: current, error: curErr } = await supabaseAdmin
      .from("categories")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (curErr) return res.status(500).json({ error: curErr.message });
    if (!current) return res.status(404).json({ error: "Category not found" });

    // ¿tiene subcategorías?
    const { count: childrenCount, error: chErr } = await supabaseAdmin
      .from("categories")
      .select("id", { count: "exact", head: true })
      .eq("parent_id", id);

    if (chErr) return res.status(500).json({ error: chErr.message });
    if ((childrenCount || 0) > 0) {
      return res.status(409).json({ error: "Cannot delete: category has subcategories" });
    }

    // ¿está usada en template_categories?
    const { count: linksCount, error: lkErr } = await supabaseAdmin
      .from("template_categories")
      .select("id", { count: "exact", head: true })
      .eq("category_id", id);

    if (lkErr) return res.status(500).json({ error: lkErr.message });
    if ((linksCount || 0) > 0) {
      return res.status(409).json({ error: "Cannot delete: category is linked to templates" });
    }

    const { error } = await supabaseAdmin.from("categories").delete().eq("id", id);
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listCategories,
  getCategory,
  createCategory,
  patchCategory,
  deleteCategory,
};
