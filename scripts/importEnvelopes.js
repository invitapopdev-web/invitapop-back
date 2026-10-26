const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { supabaseAdmin } = require("../src/config/supabaseClient");
const {
  deleteImageFromStorage,
  uploadProcessedImageToStorage,
} = require("../src/utils/storageUtils");

const catalog = require("./envelope-catalog.json");

const DEFAULT_SOURCE =
  "C:\\Users\\aldoc\\Documents\\Documents\\Work proyects\\invitapop\\Invitapop\\Sobres";
const BUCKET = "design-assets";
const FOLDER = "envelopes";
const DEFAULT_DELAY_MS = 4000;
const MAX_BYTES = 2 * 1024 * 1024;
const EXPECTED_COUNT = 232;
const outputDir = path.resolve(__dirname, "..", "..", "output");
const progressPath = path.join(outputDir, "envelope-import-progress.jsonl");
const reportPath = path.join(outputDir, "envelope-import-report.json");

function parseArgs(argv) {
  const flags = new Set(argv.filter((arg) => arg.startsWith("--") && !arg.includes("=")));
  const values = Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const index = arg.indexOf("=");
        return [arg.slice(2, index), arg.slice(index + 1)];
      })
  );

  return {
    execute: flags.has("--execute"),
    source: values.source || DEFAULT_SOURCE,
    delayMs: Number.parseInt(values["delay-ms"] || String(DEFAULT_DELAY_MS), 10),
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function parseFileName(fileName) {
  const match = fileName.match(/^(\d+)_(\d+)_(.+)_sobre\.png$/iu);
  if (!match) return null;
  return {
    order: Number.parseInt(match[1], 10),
    reference: Number.parseInt(match[2], 10),
    sourceLabel: match[3],
  };
}

function loadFiles(source) {
  if (!fs.existsSync(source)) throw new Error(`No existe la carpeta: ${source}`);

  return fs
    .readdirSync(source, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".png"))
    .map((entry) => {
      const parsed = parseFileName(entry.name);
      if (!parsed) throw new Error(`Nombre de archivo no reconocido: ${entry.name}`);
      const filePath = path.join(source, entry.name);
      const stats = fs.statSync(filePath);
      return {
        ...parsed,
        fileName: entry.name,
        filePath,
        bytes: stats.size,
        name: catalog.names[String(parsed.order)],
      };
    })
    .sort((a, b) => a.order - b.order);
}

function validateFiles(files, delayMs) {
  const errors = [];
  const warnings = [];
  const orders = new Set();
  const names = new Set();
  const hashes = new Map();

  if (files.length !== EXPECTED_COUNT) {
    errors.push(`Se esperaban ${EXPECTED_COUNT} archivos y se encontraron ${files.length}`);
  }
  if (!Number.isFinite(delayMs) || delayMs < 2000) {
    errors.push("La pausa debe ser de al menos 2000 ms");
  }

  for (const file of files) {
    if (!file.name) errors.push(`Falta nombre comercial para el orden ${file.order}`);
    if (file.bytes > MAX_BYTES) errors.push(`${file.fileName} supera 2 MB`);
    if (orders.has(file.order)) errors.push(`Orden repetido: ${file.order}`);
    if (names.has(file.name)) errors.push(`Nombre comercial repetido: ${file.name}`);
    orders.add(file.order);
    names.add(file.name);

    const hash = sha256(fs.readFileSync(file.filePath));
    if (hashes.has(hash)) {
      warnings.push(`Imagen idéntica: ${hashes.get(hash)} = ${file.fileName}`);
    } else {
      hashes.set(hash, file.fileName);
    }
  }

  for (let order = 1; order <= EXPECTED_COUNT; order += 1) {
    if (!orders.has(order)) errors.push(`Falta el orden ${order}`);
  }

  return { errors, warnings };
}

async function loadExisting() {
  const { data, error } = await supabaseAdmin
    .from("design_assets")
    .select("id, type, name, image_url, storage_path, sort_order, is_active")
    .eq("type", "envelope")
    .order("sort_order", { ascending: true });
  if (error) throw new Error(`No se pudieron consultar los sobres existentes: ${error.message}`);
  return data || [];
}

function classify(files, existing) {
  const byOrder = new Map(existing.map((asset) => [Number(asset.sort_order), asset]));
  const byName = new Map(existing.map((asset) => [String(asset.name).toLocaleLowerCase("es"), asset]));
  const plan = [];

  for (const file of files) {
    const sameOrder = byOrder.get(file.order);
    const sameName = byName.get(file.name.toLocaleLowerCase("es"));
    if (sameOrder && sameOrder.name === file.name) {
      plan.push({ ...file, action: "skip", reason: "Ya existe el mismo nombre y orden", asset: sameOrder });
    } else if (sameOrder) {
      plan.push({ ...file, action: "conflict", reason: `El orden ya lo usa “${sameOrder.name}”`, asset: sameOrder });
    } else if (sameName) {
      plan.push({ ...file, action: "conflict", reason: `El nombre ya existe con orden ${sameName.sort_order}`, asset: sameName });
    } else {
      plan.push({ ...file, action: "upload" });
    }
  }

  return plan;
}

function appendProgress(entry) {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.appendFileSync(progressPath, `${JSON.stringify(entry)}\n`, "utf8");
}

function writeReport(report) {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function uploadOne(item) {
  const input = fs.readFileSync(item.filePath);
  const uploaded = await uploadProcessedImageToStorage({
    bucket: BUCKET,
    folder: FOLDER,
    buffer: input,
    maxSizeInBytes: MAX_BYTES,
  });

  const payload = {
    type: "envelope",
    name: item.name,
    image_url: uploaded.url,
    storage_path: uploaded.path,
    sort_order: item.order,
    is_active: true,
  };

  const { data, error } = await supabaseAdmin
    .from("design_assets")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    await deleteImageFromStorage(uploaded.url);
    throw new Error(error.message);
  }

  return data;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const files = loadFiles(options.source);
  const validation = validateFiles(files, options.delayMs);

  console.log(`Modo: ${options.execute ? "IMPORTACIÓN REAL" : "SIMULACIÓN"}`);
  console.log(`Archivos: ${files.length}`);
  console.log(`Pausa: ${options.delayMs} ms`);
  for (const warning of validation.warnings) console.warn(`AVISO: ${warning}`);
  if (validation.errors.length) {
    for (const error of validation.errors) console.error(`ERROR: ${error}`);
    process.exitCode = 1;
    return;
  }

  const existing = await loadExisting();
  const plan = classify(files, existing);
  const conflicts = plan.filter((item) => item.action === "conflict");
  const pending = plan.filter((item) => item.action === "upload");
  const skipped = plan.filter((item) => item.action === "skip");

  console.log(`Sobres existentes: ${existing.length}`);
  console.log(`Pendientes: ${pending.length}`);
  console.log(`Ya importados: ${skipped.length}`);
  console.log(`Conflictos: ${conflicts.length}`);
  for (const conflict of conflicts) {
    console.error(`CONFLICTO #${conflict.order}: ${conflict.name} — ${conflict.reason}`);
  }

  const baseReport = {
    generatedAt: new Date().toISOString(),
    mode: options.execute ? "execute" : "dry-run",
    source: options.source,
    delayMs: options.delayMs,
    counts: {
      files: files.length,
      existing: existing.length,
      pending: pending.length,
      skipped: skipped.length,
      conflicts: conflicts.length,
    },
    warnings: validation.warnings,
    conflicts: conflicts.map(({ order, fileName, name, reason }) => ({ order, fileName, name, reason })),
    catalog: plan.map(({ order, reference, fileName, name, action, reason }) => ({
      order,
      reference,
      fileName,
      name,
      action,
      reason: reason || null,
    })),
  };

  if (!options.execute) {
    writeReport(baseReport);
    console.log(`Informe: ${reportPath}`);
    return;
  }
  if (conflicts.length) {
    writeReport(baseReport);
    throw new Error("Hay conflictos. Se cancela la importación para evitar sobres duplicados o sobrescritos.");
  }

  let uploadedCount = 0;
  const failures = [];
  for (let index = 0; index < pending.length; index += 1) {
    const item = pending[index];
    const position = `${index + 1}/${pending.length}`;
    console.log(`[${position}] Subiendo #${item.order} — ${item.name}`);
    try {
      const asset = await uploadOne(item);
      uploadedCount += 1;
      appendProgress({
        at: new Date().toISOString(),
        status: "uploaded",
        order: item.order,
        fileName: item.fileName,
        name: item.name,
        assetId: asset.id,
        storagePath: asset.storage_path,
      });
      console.log(`[${position}] OK — ${asset.id}`);
    } catch (error) {
      const failure = {
        order: item.order,
        fileName: item.fileName,
        name: item.name,
        error: error.message,
      };
      failures.push(failure);
      appendProgress({ at: new Date().toISOString(), status: "failed", ...failure });
      console.error(`[${position}] ERROR — ${error.message}`);
      break;
    }

    if (index < pending.length - 1) {
      const jitter = Math.floor(Math.random() * 1001);
      await wait(options.delayMs + jitter);
    }
  }

  const finalAssets = await loadExisting();
  const finalMatches = classify(files, finalAssets).filter((item) => item.action === "skip").length;
  const finalReport = {
    ...baseReport,
    completedAt: new Date().toISOString(),
    uploadedThisRun: uploadedCount,
    failures,
    finalEnvelopeCount: finalAssets.length,
    finalCatalogMatches: finalMatches,
  };
  writeReport(finalReport);

  console.log(`Subidos en esta ejecución: ${uploadedCount}`);
  console.log(`Coincidencias finales del catálogo: ${finalMatches}/${EXPECTED_COUNT}`);
  console.log(`Informe: ${reportPath}`);
  if (failures.length || finalMatches !== EXPECTED_COUNT) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
