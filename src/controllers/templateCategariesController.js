// controllers/templateCategoriesController.js
const { supabaseAdmin } = require("../config/supabaseClient");

// =========================
// GET (PÚBLICO)
// =========================
// GET /api/template-categories?template_id=UUID
// Devuelve las categorías asignadas a un template
async function getTemplateCategories(req, res, next) {
  try {
    const { template_id } = req.query;

    if (!template_id) {
      return res.status(400).json({ error: "template_id is required" });
    }

    const { data, error } = await supabaseAdmin
      .from("template_categories")
      .select(`
        id,
        category_id,
        template_id,
        categories (
          id,
          name,
          slug,
          parent_id
        )
      `)
      .eq("template_id", template_id);

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ items: data });
  } catch (err) {
    next(err);
  }
}

// =========================
// POST (ADMIN)
// =========================
// POST /api/template-categories
// body: { template_id, category_ids: [] }
async function createTemplateCategories(req, res, next) {
  try {
    const { template_id, category_ids } = req.body || {};

    if (!template_id || !Array.isArray(category_ids)) {
      return res.status(400).json({
        error: "template_id and category_ids[] are required",
      });
    }

    if (category_ids.length === 0) {
      return res.status(400).json({
        error: "category_ids cannot be empty",
      });
    }

    const rows = category_ids.map((category_id) => ({
      template_id,
      category_id,
    }));

    const { data, error } = await supabaseAdmin
      .from("template_categories")
      .insert(rows)
      .select("*");

    if (error) return res.status(500).json({ error: error.message });

    return res.status(201).json({ items: data });
  } catch (err) {
    next(err);
  }
}

// =========================
// PUT (ADMIN)
// =========================
// PUT /api/template-categories/:template_id
// body: { category_ids: [] }
// Reemplaza TODAS las categorías del template
async function replaceTemplateCategories(req, res, next) {
  try {
    const { template_id } = req.params;
    const { category_ids } = req.body || {};

    if (!template_id || !Array.isArray(category_ids)) {
      return res.status(400).json({
        error: "template_id param and category_ids[] are required",
      });
    }

    // 1️⃣ borrar relaciones actuales
    const { error: deleteError } = await supabaseAdmin
      .from("template_categories")
      .delete()
      .eq("template_id", template_id);

    if (deleteError) {
      return res.status(500).json({ error: deleteError.message });
    }

    // 2️⃣ si no hay categorías nuevas, fin
    if (category_ids.length === 0) {
      return res.json({ items: [] });
    }

    // 3️⃣ insertar nuevas relaciones
    const rows = category_ids.map((category_id) => ({
      template_id,
      category_id,
    }));

    const { data, error } = await supabaseAdmin
      .from("template_categories")
      .insert(rows)
      .select("*");

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ items: data });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getTemplateCategories,
  createTemplateCategories,
  replaceTemplateCategories,
};
