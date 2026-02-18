// controllers/carouselController.js
const { supabaseAdmin } = require("../config/supabaseClient");
const crypto = require("crypto");

const BUCKET = "templates"; // Reusing the templates bucket or 'images' if it exists. Based on user info it should be 'carousel' folder inside a bucket.

async function deleteImageFromStorage(url) {
    if (!url) return;
    try {
        // Extract path from public URL
        // Public URL format: https://[project].supabase.co/storage/v1/object/public/[bucket]/[path]
        const parts = url.split("/storage/v1/object/public/");
        if (parts.length < 2) return;
        const fullPath = parts[1];
        const bucket = fullPath.split("/")[0];
        const path = fullPath.split("/").slice(1).join("/");

        await supabaseAdmin.storage.from(bucket).remove([path]);
    } catch (err) {
        console.error("Error deleting image from storage:", err);
    }
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
            const ext = file.mimetype.split("/")[1];
            const name = `${Date.now()}-pc-${crypto.randomBytes(4).toString("hex")}.${ext}`;
            const path = `carousel/${name}`;
            const { data, error } = await supabaseAdmin.storage.from(BUCKET).upload(path, file.buffer, { contentType: file.mimetype });
            if (error) return res.status(500).json({ error: "Error uploading PC image: " + error.message });
            pcImageUrl = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
        }

        if (files.mobileImage) {
            const file = files.mobileImage[0];
            const ext = file.mimetype.split("/")[1];
            const name = `${Date.now()}-mobile-${crypto.randomBytes(4).toString("hex")}.${ext}`;
            const path = `carousel/${name}`;
            const { data, error } = await supabaseAdmin.storage.from(BUCKET).upload(path, file.buffer, { contentType: file.mimetype });
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
            const ext = file.mimetype.split("/")[1];
            const name = `${Date.now()}-pc-${crypto.randomBytes(4).toString("hex")}.${ext}`;
            const path = `carousel/${name}`;

            const { data, error } = await supabaseAdmin.storage.from(BUCKET).upload(path, file.buffer, { contentType: file.mimetype });
            if (error) return res.status(500).json({ error: "Error uploading PC image: " + error.message });

            // Delete old image
            await deleteImageFromStorage(current.pcImage);
            patch.pcImage = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
        }

        if (files.mobileImage) {
            const file = files.mobileImage[0];
            const ext = file.mimetype.split("/")[1];
            const name = `${Date.now()}-mobile-${crypto.randomBytes(4).toString("hex")}.${ext}`;
            const path = `carousel/${name}`;

            const { data, error } = await supabaseAdmin.storage.from(BUCKET).upload(path, file.buffer, { contentType: file.mimetype });
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
