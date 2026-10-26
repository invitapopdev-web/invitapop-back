const { supabaseAdmin } = require("../config/supabaseClient");
const {
    uploadProcessedImageToStorage,
} = require("../utils/storageUtils");

const BUCKET = "templates";

async function uploadEventImage(req, res, next) {
    try {
        const { id: eventId } = req.params;
        const { data: event, error } = await supabaseAdmin
            .from("events").select("id").eq("id", eventId)
            .eq("user_id", req.user.id).maybeSingle();
        if (error) return res.status(500).json({ error: "Error checking event" });
        if (!event) return res.status(404).json({ error: "Event not found" });
        const file = req.file;

        if (!file) {
            return res.status(400).json({ error: "No se proporcionó ningún archivo" });
        }

        const uploaded = await uploadProcessedImageToStorage({
            bucket: BUCKET,
            folder: `event/${eventId}`,
            buffer: file.buffer,
        });

        // Old files are removed only after the event JSON is committed.

        return res.json({
            ok: true,
            url: uploaded.url,
            path: uploaded.path,
        });
    } catch (err) {
        next(err);
    }
}

module.exports = { uploadEventImage };
