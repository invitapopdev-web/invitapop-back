const sharp = require("sharp");

/**
 * Backend image processing (Sharp)
 * - NO cambia dimensiones (NO resize)
 * - Convierte a WebP
 * - Intenta bajar a <= 500KB bajando quality
 * - Si no se puede sin bajar de MIN_QUALITY, devuelve el mejor intento (MIN_QUALITY)
 */
async function processImage(buffer, maxSizeInBytes = 500 * 1024) {
    try {
        const input = sharp(buffer, { failOn: "none" });
        const metadata = await input.metadata();
        const isWebP = metadata.format === "webp";

        // 1) Si ya es WebP y pesa <= maxSize: NO TOCAR
        if (isWebP && buffer.length <= maxSizeInBytes) {
            return buffer;
        }

        // 2) Encoder WebP (SIN resize)
        // Nota: preset "photo" es ideal para fotos; si tienes banners con texto/logos,
        // podrías cambiar a "default" o incluso detectar por tipo.
        const START_QUALITY = 94;
        const MIN_QUALITY = 70;
        const STEP = 4;

        const encode = async (q) => {
            return sharp(buffer, { failOn: "none" })
                .webp({
                    quality: q,
                    effort: 6,
                    smartSubsample: true,
                    preset: "photo",
                })
                .toBuffer();
        };

        let quality = START_QUALITY;
        let out = await encode(quality);

        // 3) Ajuste de quality para intentar cumplir maxSize
        while (out.length > maxSizeInBytes && quality - STEP >= MIN_QUALITY) {
            quality -= STEP;
            out = await encode(quality);
        }

        // 4) Si aún no entra, devolvemos el mejor intento (ya en MIN_QUALITY o cerca)
        return out;
    } catch (err) {
        console.error("Error processing image with sharp:", err);
        return buffer;
    }
}

module.exports = { processImage };
