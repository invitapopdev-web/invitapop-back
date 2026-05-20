const { supabaseAdmin } = require("../config/supabaseClient");
const {
  deleteImageFromStorage,
  uploadProcessedImageToStorage,
} = require("../utils/storageUtils");

const BUCKET = "design-assets";
const MB = 1024 * 1024;
const DESIGN_ASSET_MAX_BYTES = 2 * MB;
const VALID_TYPES = new Set(["background", "envelope"]);
const FOLDERS = {
  background: "backgrounds",
  envelope: "envelopes",
};

function isValidType(type) {
  return typeof type === "string" && VALID_TYPES.has(type);
}

function parseSortOrder(value) {
  if (value === undefined || value === null || value === "") return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function badRequest(res, error) {
  return res.status(400).json({ error });
}

function formatMb(bytes) {
  const value = bytes / MB;
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} MB`;
}

async function listDesignAssets(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ error: "No autenticado" });

    const type = String(req.query.type || "").trim();
    if (!isValidType(type)) return badRequest(res, "Invalid type");

    const { data, error } = await supabaseAdmin
      .from("design_assets")
      .select("id, created_at, type, name, image_url, sort_order")
      .eq("type", type)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ assets: data || [] });
  } catch (err) {
    next(err);
  }
}

async function listAdminDesignAssets(req, res, next) {
  try {
    const type = String(req.query.type || "all").trim();
    if (type !== "all" && !isValidType(type)) return badRequest(res, "Invalid type");

    let query = supabaseAdmin
      .from("design_assets")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });

    if (type !== "all") query = query.eq("type", type);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ assets: data || [] });
  } catch (err) {
    next(err);
  }
}

async function createDesignAsset(req, res, next) {
  try {
    const { type, name, sort_order } = req.body || {};
    const file = req.file;

    if (!isValidType(type)) return badRequest(res, "Invalid type");
    if (!name || typeof name !== "string") return badRequest(res, "name is required");
    if (!file) return badRequest(res, "Missing file");
    if (file.buffer.length > DESIGN_ASSET_MAX_BYTES) {
      return res.status(413).json({
        error: `La imagen pesa ${formatMb(file.buffer.length)}. Máximo permitido: 2 MB.`,
      });
    }

    const uploaded = await uploadProcessedImageToStorage({
      bucket: BUCKET,
      folder: FOLDERS[type],
      buffer: file.buffer,
      maxSizeInBytes: DESIGN_ASSET_MAX_BYTES,
    });

    const payload = {
      type,
      name: name.trim(),
      image_url: uploaded.url,
      storage_path: uploaded.path,
      sort_order: parseSortOrder(sort_order),
      is_active: true,
    };

    const { data, error } = await supabaseAdmin
      .from("design_assets")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      await deleteImageFromStorage(uploaded.url);
      return res.status(500).json({ error: error.message });
    }

    return res.status(201).json({ asset: data });
  } catch (err) {
    next(err);
  }
}

async function patchDesignAsset(req, res, next) {
  try {
    const { id } = req.params;
    const { name, sort_order, is_active } = req.body || {};

    const patch = { updated_at: new Date().toISOString() };
    if (typeof name === "string") patch.name = name.trim();
    if (sort_order !== undefined) patch.sort_order = parseSortOrder(sort_order);
    if (typeof is_active === "boolean") patch.is_active = is_active;

    if (Object.keys(patch).length === 1) return badRequest(res, "No fields to update");

    const { data, error } = await supabaseAdmin
      .from("design_assets")
      .update(patch)
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Asset not found" });

    return res.json({ asset: data });
  } catch (err) {
    next(err);
  }
}

async function deleteDesignAsset(req, res, next) {
  try {
    const { id } = req.params;

    const { data: current, error: fetchError } = await supabaseAdmin
      .from("design_assets")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (fetchError) return res.status(500).json({ error: fetchError.message });
    if (!current) return res.status(404).json({ error: "Asset not found" });

    const { error: deleteError } = await supabaseAdmin
      .from("design_assets")
      .delete()
      .eq("id", id);

    if (deleteError) return res.status(500).json({ error: deleteError.message });

    await deleteImageFromStorage(current.image_url);

    return res.json({ asset: current, deleted: true });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listDesignAssets,
  listAdminDesignAssets,
  createDesignAsset,
  patchDesignAsset,
  deleteDesignAsset,
};
