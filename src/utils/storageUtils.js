const { supabaseAdmin } = require("../config/supabaseClient");
const crypto = require("crypto");
const { processImage } = require("./imageUtils");

function parsePublicStorageUrl(url) {
    if (!url || typeof url !== "string") return null;

    const baseUrl = url.split("?")[0];
    const parts = baseUrl.split("/storage/v1/object/public/");
    if (parts.length < 2) return null;

    const fullPath = parts[1];
    const bucket = fullPath.split("/")[0];
    const path = fullPath.split("/").slice(1).join("/");

    if (!bucket || !path) return null;
    return { bucket, path };
}

async function uploadProcessedImageToStorage({ bucket, folder, buffer }) {
    const processedBuffer = await processImage(buffer);
    const name = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.webp`;
    const cleanFolder = String(folder || "").replace(/^\/+|\/+$/g, "");
    const path = cleanFolder ? `${cleanFolder}/${name}` : name;

    const { error } = await supabaseAdmin.storage
        .from(bucket)
        .upload(path, processedBuffer, { contentType: "image/webp" });

    if (error) {
        const err = new Error(error.message);
        err.cause = error;
        throw err;
    }

    const { data: pub } = supabaseAdmin.storage.from(bucket).getPublicUrl(path);
    return { url: pub.publicUrl, path };
}

/**
 * Deletes an image from Supabase Storage given its public URL.
 * @param {string} url - The public URL of the image.
 * @returns {Promise<void>}
 */
async function deleteImageFromStorage(url) {
    if (!url) return;
    try {
        console.log("Attempting to delete image:", url);
        const parsed = parsePublicStorageUrl(url);
        if (!parsed) {
            console.warn("URL does not match expected Supabase public format:", url);
            return;
        }

        const { bucket, path } = parsed;

        console.log(`Deleting from bucket: ${bucket}, path: ${path}`);
        const { data, error } = await supabaseAdmin.storage.from(bucket).remove([path]);

        if (error) {
            console.error(`Error deleting image from storage (${path}):`, error.message);
        } else {
            console.log(`Successfully deleted: ${path}`, data);
        }
    } catch (err) {
        console.error("Error in deleteImageFromStorage:", err);
    }
}

module.exports = {
    deleteImageFromStorage,
    parsePublicStorageUrl,
    uploadProcessedImageToStorage,
};
