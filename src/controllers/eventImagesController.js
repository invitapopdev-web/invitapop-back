const {
    deleteImageFromStorage,
    uploadProcessedImageToStorage,
} = require("../utils/storageUtils");

const BUCKET = "templates";

async function uploadEventImage(req, res, next) {
    try {
        const { id: eventId } = req.params;
        const { oldUrl } = req.body;
        const file = req.file;

        if (!file) {
            return res.status(400).json({ error: "No se proporcionó ningún archivo" });
        }

        const uploaded = await uploadProcessedImageToStorage({
            bucket: BUCKET,
            folder: `event/${eventId}`,
            buffer: file.buffer,
        });

        if (oldUrl) await deleteImageFromStorage(oldUrl);

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
