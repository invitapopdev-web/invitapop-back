const { supabaseAdmin } = require("../config/supabaseClient");

/**
 * Deletes an image from Supabase Storage given its public URL.
 * @param {string} url - The public URL of the image.
 * @returns {Promise<void>}
 */
async function deleteImageFromStorage(url) {
    if (!url) return;
    try {
        console.log("Attempting to delete image:", url);
        // Public URL format: https://[project].supabase.co/storage/v1/object/public/[bucket]/[path]
        const baseUrl = url.split("?")[0]; // Remove potential query params
        const parts = baseUrl.split("/storage/v1/object/public/");
        if (parts.length < 2) {
            console.warn("URL does not match expected Supabase public format:", url);
            return;
        }

        const fullPath = parts[1];
        const bucket = fullPath.split("/")[0];
        const path = fullPath.split("/").slice(1).join("/");

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

module.exports = { deleteImageFromStorage };
