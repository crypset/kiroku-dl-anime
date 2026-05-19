import { readFile } from "fs/promises";
import { resolve } from "path";

import rawConfigFile from "../../config.json" with { type: "json" }

const CONFIG_PATH = resolve(process.cwd(), "config.json");

/**
 * Loads, validates, and normalizes config.json from project root.
 * @returns {Promise<object>}
 */
export async function loadConfig() {
  let raw;
  try {
    raw = await readFile(CONFIG_PATH, "utf-8");
  } catch (err) {
    throw new Error(`Cannot read config.json: ${err.message}`);
  }

  let config;
  try {
    config = JSON.parse(raw);
  } catch (err) {
    throw new Error(`config.json is not valid JSON: ${err.message}`);
  }

  validateConfig(config);
  return applyDefaults(config);
}

function validateConfig(config) {
  if (!config.searches || !Array.isArray(config.searches)) {
    throw new Error("config.json must have a 'searches' array");
  }
  for (const entry of config.searches) {
    if (!entry.url)  throw new Error(`Search entry missing 'url': ${JSON.stringify(entry)}`);
    if (!entry.name) throw new Error(`Search entry missing 'name': ${JSON.stringify(entry)}`);
  }
}

export const BROWSER = rawConfigFile.browser

/**
 * Заповнює відсутні секції дефолтними значеннями
 * щоб решта коду не мусіла скрізь перевіряти ?? undefined.
 */
function applyDefaults(config) {
  return {
    ...config,
    app: {
      downloadDir: "downloads",
      ...config.app,
    },
    download: {
      delay: 1500,
      pageDelay: 500,
      searchDelay: 3000,
      skipErrors: true,
      skipDownloaded: true,
      useDatabase: false,
      ...config.download,
    },
    database: {
      enabled: false,
      ...config.database,
    },
    animefox: {
      baseUrl: "https://www.animefox.org",
      iframePlayerPath: "/engine/ajax/iframePlayer.php",
      qualityOrder: ["1080p", "720p", "480p", "360p", "240p"],
      ...config.animefox,
    },
  };
}