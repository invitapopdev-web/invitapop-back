const { supabaseAdmin } = require("../config/supabaseClient");
const crypto = require("crypto");
const { processImage } = require("../utils/imageUtils");
const { deleteImageFromStorage } = require("../utils/storageUtils");

const BUCKET = "templates";

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
            const processedBuffer = await processImage(file.buffer);
            const name = `${Date.now()}-pc-${crypto.randomBytes(4).toString("hex")}.webp`;
            const path = `carousel/${name}`;
            const { data, error } = await supabaseAdmin.storage.from(BUCKET).upload(path, processedBuffer, { contentType: "image/webp" });
            if (error) return res.status(500).json({ error: "Error uploading PC image: " + error.message });
            pcImageUrl = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
        }

        if (files.mobileImage) {
            const file = files.mobileImage[0];
            const processedBuffer = await processImage(file.buffer);
            const name = `${Date.now()}-mobile-${crypto.randomBytes(4).toString("hex")}.webp`;
            const path = `carousel/${name}`;
            const { data, error } = await supabaseAdmin.storage.from(BUCKET).upload(path, processedBuffer, { contentType: "image/webp" });
            if (error) return res.status(500).json({ error: "Error uploading mobile image: " + error.message });
            mobileImageUrl = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
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
            const processedBuffer = await processImage(file.buffer);
            const name = `${Date.now()}-pc-${crypto.randomBytes(4).toString("hex")}.webp`;
            const path = `carousel/${name}`;

            const { data, error } = await supabaseAdmin.storage.from(BUCKET).upload(path, processedBuffer, { contentType: "image/webp" });
            if (error) return res.status(500).json({ error: "Error uploading PC image: " + error.message });

            // Delete old image
            await deleteImageFromStorage(current.pcImage);
            patch.pcImage = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
        }

        if (files.mobileImage) {
            const file = files.mobileImage[0];
            const processedBuffer = await processImage(file.buffer);
            const name = `${Date.now()}-mobile-${crypto.randomBytes(4).toString("hex")}.webp`;
            const path = `carousel/${name}`;

            const { data, error } = await supabaseAdmin.storage.from(BUCKET).upload(path, processedBuffer, { contentType: "image/webp" });
            if (error) return res.status(500).json({ error: "Error uploading mobile image: " + error.message });

            // Delete old image
            await deleteImageFromStorage(current.mobileImage);
            patch.mobileImage = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
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
