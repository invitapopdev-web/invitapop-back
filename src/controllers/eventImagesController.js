const crypto = require("crypto");
const { supabaseAdmin } = require("../config/supabaseClient");
const { processImage } = require("../utils/imageUtils");
const { deleteImageFromStorage } = require("../utils/storageUtils");

const BUCKET = "templates";

async function uploadEventImage(req, res, next) {
    try {
        const { id: eventId } = req.params;
        const { oldUrl } = req.body;
        const file = req.file;

        if (!file) {
            return res.status(400).json({ error: "No se proporcionó ningún archivo" });
        }

        // 1. Opcional: Borrar imagen anterior si se provee oldUrl
        if (oldUrl) {
            await deleteImageFromStorage(oldUrl);
        }

        // 2. Procesar imagen (WebP, < 500KB)
        const processedBuffer = await processImage(file.buffer);

        // 3. Subir a Supabase Storage
        const name = `${crypto.randomUUID()}.webp`;
        const path = `event/${eventId}/${name}`;

        const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
            .from(BUCKET)
            .upload(path, processedBuffer, {
                contentType: "image/webp",
                upsert: true
            });

        if (uploadError) {
            return res.status(500).json({ error: uploadError.message });
        }

        // 4. Obtener URL pública
        const { data: pub } = supabaseAdmin.storage
            .from(BUCKET)
            .getPublicUrl(path);

        res.json({
            ok: true,
            url: pub.publicUrl,
            path: path
        });
    } catch (err) {
        next(err);
    }
}

module.exports = { uploadEventImage };
