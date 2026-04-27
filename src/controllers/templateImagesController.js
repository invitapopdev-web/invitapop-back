const { supabaseAdmin } = require("../config/supabaseClient");
const {
  deleteImageFromStorage,
  uploadProcessedImageToStorage,
} = require("../utils/storageUtils");

const BUCKET = "templates";

const MAP = {
  thumbnail: { column: "thumbnail_url" },
  background: { jsonKey: "backgroundImageUrl" },
  invitation: { jsonKey: "invitationImageUrl" },
  envelope: { jsonKey: "envelopeImageUrl" },
  overlay1: { jsonKey: "overlay1Url" },
  overlay2: { jsonKey: "overlay2Url" },
};

function safeJson(v) {
  if (!v) return {};
  if (typeof v === "object") return v;
  try {
    return JSON.parse(v);
  } catch {
    return {};
  }
}

async function uploadTemplateImage(req, res, next) {
  try {
    const { id } = req.params;
    const { type } = req.body;
    const file = req.file;

    if (!MAP[type]) return res.status(400).json({ error: "Invalid type" });
    if (!file) return res.status(400).json({ error: "Missing file" });

    const { data: tpl, error } = await supabaseAdmin
      .from("templates")
      .select("id, thumbnail_url, design_json")
      .eq("id", id)
      .maybeSingle();

    if (error || !tpl) return res.status(404).json({ error: "Template not found" });

    let oldImageUrl = null;
    if (MAP[type].column) {
      oldImageUrl = tpl[MAP[type].column];
    } else {
      const dj = safeJson(tpl.design_json);
      oldImageUrl = dj[MAP[type].jsonKey];
    }

    const uploaded = await uploadProcessedImageToStorage({
      bucket: BUCKET,
      folder: `templates/${id}/${type}`,
      buffer: file.buffer,
    });
    const url = uploaded.url;
    const patch = { updated_at: new Date().toISOString() };

    if (MAP[type].column) {
      patch[MAP[type].column] = url;
    } else {
      const dj = safeJson(tpl.design_json);
      dj[MAP[type].jsonKey] = url;
      patch.design_json = JSON.stringify(dj);
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("templates")
      .update(patch)
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (updateError || !updated) {
      await deleteImageFromStorage(url);
      return res.status(500).json({ error: updateError?.message || "Error updating template" });
    }

    if (oldImageUrl && oldImageUrl !== url) {
      await deleteImageFromStorage(oldImageUrl);
    }

    res.json({ ok: true, url, template: updated });
  } catch (err) {
    next(err);
  }
}

module.exports = { uploadTemplateImage };
