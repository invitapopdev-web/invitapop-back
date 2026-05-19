const { supabaseAdmin } = require("../config/supabaseClient");
const crypto = require("crypto");
const { processImage } = require("../utils/imageUtils");
const { deleteImageFromStorage } = require("../utils/storageUtils");

const BUCKET = "templates";
const MB = 1024 * 1024;
const CAROUSEL_MEDIA_LIMITS = {
    pc: {
        image: 5 * MB,
        gif: 5 * MB,
        video: 4.5 * MB,
    },
    mobile: {
        image: 5 * MB,
        gif: 4 * MB,
        video: 4 * MB,
    },
};

function isGifFile(file) {
    const mimetype = String(file?.mimetype || "").toLowerCase();
    const originalname = String(file?.originalname || "").toLowerCase();
    return mimetype === "image/gif" || originalname.endsWith(".gif");
}

function getCarouselUploadFormat(file) {
    const mimetype = String(file?.mimetype || "").toLowerCase();
    const originalname = String(file?.originalname || "").toLowerCase();

    if (mimetype === "video/mp4" || originalname.endsWith(".mp4")) {
        return { extension: "mp4", contentType: "video/mp4", kind: "video", shouldProcess: false };
    }

    if (mimetype === "video/webm" || originalname.endsWith(".webm")) {
        return { extension: "webm", contentType: "video/webm", kind: "video", shouldProcess: false };
    }

    if (isGifFile(file)) {
        return { extension: "gif", contentType: "image/gif", kind: "gif", shouldProcess: false };
    }

    return { extension: "webp", contentType: "image/webp", kind: "image", shouldProcess: true };
}

function formatMb(bytes) {
    const value = bytes / MB;
    return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} MB`;
}

function assertCarouselMediaSize(file, variant, format) {
    const limit = CAROUSEL_MEDIA_LIMITS[variant]?.[format.kind] || CAROUSEL_MEDIA_LIMITS.pc.image;

    if (file.buffer.length <= limit) return;

    const label = variant === "pc" ? "PC" : "mobile";
    const err = new Error(`El archivo ${label} pesa ${formatMb(file.buffer.length)}. Máximo permitido: ${formatMb(limit)}.`);
    err.statusCode = 413;
    err.isUploadError = true;
    throw err;
}

async function uploadCarouselMedia(file, variant) {
    const format = getCarouselUploadFormat(file);
    assertCarouselMediaSize(file, variant, format);
    const isGif = isGifFile(file);
    const buffer = format.shouldProcess ? await processImage(file.buffer) : file.buffer;
    const name = `${Date.now()}-${variant}-${crypto.randomBytes(4).toString("hex")}.${format.extension}`;
    const path = `carousel/${name}`;

    const { error } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(path, buffer, { contentType: format.contentType });

    if (error) {
        const label = variant === "pc" ? "PC" : "mobile";
        const mediaLabel = isGif || format.contentType.startsWith("video/") ? "media" : "image";
        const err = new Error(`No se pudo subir el archivo ${label}. Revisa el tamaño y el formato del ${mediaLabel}.`);
        err.statusCode = 500;
        err.isUploadError = true;
        throw err;
    }

    return supabaseAdmin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

async function listSlides(req, res, next) {
    try {
        const { data, error } = await supabaseAdmin
            .from("carousel")
            .select("*")
            .order("sort_order", { ascending: true });

        if (error) return res.status(500).json({ error: error.message });
        return res.json({ slides: data });
    } catch (err) {
        next(err);
    }
}

async function createSlide(req, res, next) {
    try {
        const { href, title, subtitle, button, sort_order } = req.body;
        const files = req.files || {};

        // Upload images if present
        let pcImageUrl = null;
        let mobileImageUrl = null;

        if (files.pcImage) {
            const file = files.pcImage[0];
            pcImageUrl = await uploadCarouselMedia(file, "pc");
        }

        if (files.mobileImage) {
            const file = files.mobileImage[0];
            mobileImageUrl = await uploadCarouselMedia(file, "mobile");
        }

        const { data, error } = await supabaseAdmin
            .from("carousel")
            .insert({
                href,
                title,
                subtitle,
                button,
                pcImage: pcImageUrl,
                mobileImage: mobileImageUrl,
                sort_order: sort_order || 0
            })
            .select("*")
            .single();

        if (error) return res.status(500).json({ error: error.message });
        return res.status(201).json({ slide: data });
    } catch (err) {
        if (err.isUploadError) return res.status(err.statusCode || 500).json({ error: err.message });
        next(err);
    }
}

async function updateSlide(req, res, next) {
    try {
        const { id } = req.params;
        const { href, title, subtitle, button, sort_order } = req.body;
        const files = req.files || {};

        const { data: current, error: fetchErr } = await supabaseAdmin
            .from("carousel")
            .select("*")
            .eq("id", id)
            .single();

        if (fetchErr || !current) return res.status(404).json({ error: "Slide not found" });

        const patch = { href, title, subtitle, button, sort_order };

        // Clean undefined fields
        Object.keys(patch).forEach(key => patch[key] === undefined && delete patch[key]);

        if (files.pcImage) {
            const file = files.pcImage[0];
            const pcImageUrl = await uploadCarouselMedia(file, "pc");

            // Delete old image
            await deleteImageFromStorage(current.pcImage);
            patch.pcImage = pcImageUrl;
        }

        if (files.mobileImage) {
            const file = files.mobileImage[0];
            const mobileImageUrl = await uploadCarouselMedia(file, "mobile");

            // Delete old image
            await deleteImageFromStorage(current.mobileImage);
            patch.mobileImage = mobileImageUrl;
        }

        const { data: updated, error: updateErr } = await supabaseAdmin
            .from("carousel")
            .update(patch)
            .eq("id", id)
            .select("*")
            .single();

        if (updateErr) return res.status(500).json({ error: updateErr.message });
        return res.json({ slide: updated });
    } catch (err) {
        if (err.isUploadError) return res.status(err.statusCode || 500).json({ error: err.message });
        next(err);
    }
}

async function deleteSlide(req, res, next) {
    try {
        const { id } = req.params;

        const { data: current, error: fetchErr } = await supabaseAdmin
            .from("carousel")
            .select("*")
            .eq("id", id)
            .single();

        if (fetchErr || !current) return res.status(404).json({ error: "Slide not found" });

        // Delete images
        await deleteImageFromStorage(current.pcImage);
        await deleteImageFromStorage(current.mobileImage);

        const { error: deleteErr } = await supabaseAdmin
            .from("carousel")
            .delete()
            .eq("id", id);

        if (deleteErr) return res.status(500).json({ error: deleteErr.message });
        return res.json({ ok: true });
    } catch (err) {
        next(err);
    }
}

module.exports = {
    listSlides,
    createSlide,
    updateSlide,
    deleteSlide
};
