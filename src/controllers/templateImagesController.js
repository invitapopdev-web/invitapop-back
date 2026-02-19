const crypto = require("crypto");
const { supabaseAdmin } = require("../config/supabaseClient");
const { processImage } = require("../utils/imageUtils");

const BUCKET = "templates";

const MAP = {
  thumbnail: { column: "thumbnail_url" },
  background: { jsonKey: "backgroundImageUrl" },
  invitation: { jsonKey: "invitationImageUrl" },
  envelope: { jsonKey: "envelopeImageUrl" },
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

    // --- Cleanup Logic: Delete old image if it exists ---
    let oldImageUrl = null;
    if (MAP[type].column) {
      oldImageUrl = tpl[MAP[type].column];
    } else {
      const dj = safeJson(tpl.design_json);
      oldImageUrl = dj[MAP[type].jsonKey];
    }

    if (oldImageUrl) {
      const { deleteImageFromStorage } = require("../utils/storageUtils");
      await deleteImageFromStorage(oldImageUrl);
    }
    // ----------------------------------------------------

    const processedBuffer = await processImage(file.buffer);
    const name = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.webp`;
    const path = `templates/${id}/${type}/${name}`;

    const up = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, processedBuffer, { contentType: "image/webp" });

    if (up.error) return res.status(500).json({ error: up.error.message });

    const { data: pub } = supabaseAdmin.storage
      .from(BUCKET)
      .getPublicUrl(path);

    const url = pub.publicUrl;
    const patch = {};

    if (MAP[type].column) {
      patch[MAP[type].column] = url;
    } else {
      const dj = safeJson(tpl.design_json);
      dj[MAP[type].jsonKey] = url;
      patch.design_json = JSON.stringify(dj);
    }

    const { data: updated } = await supabaseAdmin
      .from("templates")
      .update(patch)
      .eq("id", id)
      .select("*")
      .maybeSingle();

    res.json({ ok: true, url, template: updated });
  } catch (err) {
    next(err);
  }
}

module.exports = { uploadTemplateImage };
