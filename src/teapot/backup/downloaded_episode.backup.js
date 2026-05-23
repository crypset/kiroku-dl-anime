import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";

import { DownloadedEpisode } from "../models/index.js";
import { print } from "../../shared/utils.js";

const EXPORT_DIR = join(process.cwd(), "data", "export");
const IMPORT_DIR = join(process.cwd(), "data", "import");
const IMPORT_FILE = join(IMPORT_DIR, "import.json");

/**
 * Exports all downloaded episode records into data/export/export_<timestamp>.json.
 *
 * @returns {Promise<string>} created file path
 */
export async function exportDownloadedEpisodes() {
  await mkdir(EXPORT_DIR, { recursive: true });

  const rows = await DownloadedEpisode.findAll({
    order: [
      ["animeName", "ASC"],
      ["episodeId", "ASC"],
    ],
  });

  const records = rows.map((row) => {
    const data = row.get({ plain: true });

    return {
      animeName: data.animeName,
      episodeId: data.episodeId,
      episodeTitle: data.episodeTitle,
      downloadedAt: data.downloadedAt,
    };
  });

  const payload = {
    schema: "kiroku.downloaded_episodes",
    version: 1,
    exportedAt: new Date().toISOString(),
    count: records.length,
    records,
  };

  const outFile = join(EXPORT_DIR, `export_${timestampForFile()}.json`);
  await writeFile(outFile, JSON.stringify(payload, null, 2), "utf-8");

  print(`Exported ${records.length} downloaded episode records`, "success");
  print(`Backup file: ${outFile}`, "data");

  return outFile;
}

/**
 * Imports downloaded episode records from data/import/import.json.
 * By default it merges records into the existing DB. With clean=true it clears
 * the downloaded_episodes table before importing.
 *
 * @param {{ clean?: boolean }} options
 * @returns {Promise<{ imported: number, clean: boolean }>}
 */
export async function importDownloadedEpisodes({ clean = false } = {}) {
  await mkdir(IMPORT_DIR, { recursive: true });

  let raw;
  try {
    raw = await readFile(IMPORT_FILE, "utf-8");
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(`Import file not found. Put import.json here: ${IMPORT_FILE}`);
    }
    throw err;
  }

  const payload = JSON.parse(raw);
  const records = normalizeImportPayload(payload);

  if (clean) {
    await DownloadedEpisode.destroy({ where: {}, truncate: true });
    print("Clean import requested - existing downloaded episode records removed", "warning");
  }

  for (const record of records) {
    await DownloadedEpisode.upsert(record);
  }

  print(`Imported ${records.length} downloaded episode records`, "success");
  print(`Import mode: ${clean ? "clean" : "merge"}`, "data");

  return { imported: records.length, clean };
}

function normalizeImportPayload(payload) {
  const records = Array.isArray(payload) ? payload : payload?.records;

  if (!Array.isArray(records)) {
    throw new Error("import.json must contain a records array");
  }

  return records.map((record, index) => {
    if (!record?.animeName || !record?.episodeId) {
      throw new Error(`Invalid import record at index ${index}: animeName and episodeId are required`);
    }

    return {
      animeName: String(record.animeName),
      episodeId: String(record.episodeId),
      episodeTitle: record.episodeTitle ? String(record.episodeTitle) : null,
      downloadedAt: record.downloadedAt ? new Date(record.downloadedAt) : new Date(),
    };
  });
}

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
