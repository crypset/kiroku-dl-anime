import { readFile } from "fs/promises";
import { resolve, join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

import rawConfigFile from "../../config.json" with { type: "json" }

const CONFIG_PATH = resolve(process.cwd(), "config.json");

// ─── Paths ────────────────────────────────────────────────────────────────────

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Тимчасова директорія для сегментів під час скачування */
export const TEMP_DIR = join(PROJECT_ROOT, "data", "temp");

// ─── AnimeFox / embed player constants ───────────────────────────────────────

/** Хост embed-плеєра (використовується в Strategy A і Fallback B) */
export const EMBED_HOST = "x.tentacl.su";

/** Шлях до ендпоінту конфігурації плеєра */
export const PLAYER_API_CONFIG_PATH = "/api-config/";

/** Шлях до ендпоінту з зашифрованими сорсами */
export const PLAYER_API_PATH = "/api/";

/**
 * Fallback-ключ дешифрування CryptoJS AES.
 * Отримано з деобфускованого JS плеєра — змінюється рідко,
 * але якщо Strategy A почне падати, перевір цей ключ першим.
 */
export const CRYPTO_FALLBACK_KEY = "8eeb24d0";

// ─── Timeouts ─────────────────────────────────────────────────────────────────

/** Скільки мс чекати на window.ps / window.kaken після networkidle */
export const WINDOW_VARS_TIMEOUT_MS = 15_000;

/**
 * Додатковий час очікування (мс) у Fallback B, якщо networkidle
 * не встиг захопити /hls/ запит.
 */
export const HLS_INTERCEPT_EXTRA_WAIT_MS = 5_000;

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
      concurrency: 8,
      ...config.animefox,
    },
  };
}