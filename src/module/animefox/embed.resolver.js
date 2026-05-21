import axios from "axios";
import CryptoJS from "crypto-js";

import { print } from "../../shared/utils.js";
import {
  EMBED_HOST,
  PLAYER_API_CONFIG_PATH,
  PLAYER_API_PATH,
  CRYPTO_FALLBACK_KEY,
  WINDOW_VARS_TIMEOUT_MS,
  HLS_INTERCEPT_EXTRA_WAIT_MS,
} from "../../config/app.config.js";

/**
 * Resolves the HLS (.m3u8) master playlist URL from a player embed page.
 *
 * Strategy A (preferred):
 *   1. Open embed page in Playwright → wait for obfuscated JS to write window vars
 *   2. GET /api-config/ + POST /api/ via axios
 *   3. Decrypt CryptoJS AES response → extract /hls/ URL
 *
 * Strategy B (fallback):
 *   Intercept the /hls/ network request directly in Playwright.
 */
export class EmbedResolver {
  /**
   * @param {{ browser: import('../../module/browser/browser.js').Browser, ua: string, browserTimeout: number }} options
   */
  constructor({ browser, ua, browserTimeout }) {
    this.browser = browser;
    this.ua = ua;
    this.browserTimeout = browserTimeout;
  }

  /**
   * Returns the m3u8 URL for the given embed page.
   *
   * @param {string} embedUrl
   * @returns {Promise<string>}
   */
  async resolve(embedUrl) {
    // ── Strategy A: window vars → axios requests → decrypt ──
    try {
      const vars = await this.#extractWindowVars(embedUrl);
      print(
        `[DBG] window vars: ps=${vars.ps?.slice(0, 20)}… pd=${vars.pd} kaken=${vars.kaken?.slice(0, 20)}…`,
        "info",
      );

      const m3u8Url = await this.#resolveViaApi(vars);
      return m3u8Url;
    } catch (error) {
      print(
        `[AnimeFox] Strategy A failed (${error.message}), falling back to browser intercept`,
        "warning",
      );
      console.log(error);
    }

    // ── Strategy B (fallback): intercept /hls/ in browser ──
    return this.#resolveViaBrowserIntercept(embedUrl);
  }

  // ─── Private: Strategy A ────────────────────────────────────────────────────

  /**
   * Opens the embed page in Playwright and waits for the obfuscated JS to
   * write its vars into the window object.
   *
   * @param {string} embedUrl
   * @returns {Promise<{ apx: string, qsx: string, ps: string, pd: string, kaken: string }>}
   */
  async #extractWindowVars(embedUrl) {
    const page = await this.browser.newPage();

    try {
      await page.goto(embedUrl, {
        waitUntil: "networkidle",
        timeout: this.browserTimeout,
      });

      await page.waitForFunction(() => window.ps && window.kaken, {
        timeout: WINDOW_VARS_TIMEOUT_MS,
      });

      return await page.evaluate(() => ({
        ps: window.ps,
        pd: window.pd,
        apx: window.apx,
        qsx: window.qsx,
        kaken: window.kaken,
      }));
    } finally {
      await page.close();
    }
  }

  /**
   * Uses extracted window vars to call /api-config/ and /api/, then decrypts
   * the response to obtain the /hls/ URL.
   *
   * @param {{ apx: string, qsx: string, ps: string, pd: string, kaken: string }} vars
   * @returns {Promise<string>}
   */
  async #resolveViaApi(vars) {
    // GET /api-config/
    const apiConfigUrl =
      `${Buffer.from(vars.apx, "base64").toString()}${vars.qsx}` +
      `${PLAYER_API_CONFIG_PATH}?p=${vars.ps}&_=${vars.pd}`;

    print(`[DBG] api-config URL: ${apiConfigUrl.slice(0, 80)}…`, "info");

    const { data: encryptedConfig } = await axios.get(apiConfigUrl, {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        "Referrer-Policy": "no-referrer",
        "User-Agent": this.ua,
      },
      responseType: "text",
    });

    print(
      `[DBG] api-config response (first 100): ${String(encryptedConfig).slice(0, 100)}`,
      "info",
    );

    // POST /api/
    const apiUrl = `https://${EMBED_HOST}${PLAYER_API_PATH}?p=${vars.ps}`;
    const { data: encryptedSources } = await axios.post(apiUrl, vars.kaken, {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "text/plain",
        Origin: `https://${EMBED_HOST}`,
        "Referrer-Policy": "no-referrer",
        "User-Agent": this.ua,
      },
      responseType: "text",
    });

    print(
      `[DBG] api response (first 100): ${String(encryptedSources).slice(0, 100)}`,
      "info",
    );

    return this.#decryptHlsUrl(encryptedConfig, encryptedSources, vars);
  }

  /**
   * Decrypts the CryptoJS AES-encrypted /api/ response and extracts the HLS URL.
   *
   * Tries the window-provided localKey first, then the known fallback key.
   *
   * @param {string} encryptedConfig
   * @param {string} encryptedSources
   * @param {{ localKey?: string }} vars
   * @returns {string}
   */
  #decryptHlsUrl(encryptedConfig, encryptedSources, vars) {
    const keyCandidates = [vars.localKey, CRYPTO_FALLBACK_KEY].filter(Boolean);

    for (const key of keyCandidates) {
      try {
        const decrypted = CryptoJS.AES.decrypt(encryptedSources, key).toString(
          CryptoJS.enc.Utf8,
        );

        if (!decrypted) continue;

        const hlsUrl = this.#extractHlsFromPayload(decrypted);

        if (hlsUrl) {
          print(
            `[DBG] decrypted hls URL (key="${key}"): ${hlsUrl.slice(0, 80)}…`,
            "info",
          );
          return hlsUrl;
        }
      } catch {
        // Wrong key or corrupt payload — try next candidate
      }
    }

    throw new Error("Could not decrypt /api/ response with any known key");
  }

  /**
   * Extracts a /hls/ URL from a decrypted plaintext payload.
   * Handles JSON shapes ({ url, hls, file }, arrays) and bare URL strings.
   *
   * @param {string} plaintext
   * @returns {string|null}
   */
  #extractHlsFromPayload(plaintext) {
    try {
      const parsed = JSON.parse(plaintext);
      return (
        parsed?.url ||
        parsed?.hls ||
        parsed?.file ||
        (Array.isArray(parsed) && parsed[0]?.file) ||
        null
      );
    } catch {
      // Not JSON — search for a bare URL
      return plaintext.match(/https?:\/\/[^\s"']+\/hls\/[^\s"']+/)?.[0] ?? null;
    }
  }

  // ─── Private: Strategy B ────────────────────────────────────────────────────

  /**
   * Opens the embed page in Playwright and intercepts the /hls/ network request
   * that the player fires after its own internal decryption.
   *
   * @param {string} embedUrl
   * @returns {Promise<string>}
   */
  async #resolveViaBrowserIntercept(embedUrl) {
    const page = await this.browser.newPage();

    try {
      /** @type {string | null} */
      let m3u8Url = null;

      page.on("request", (req) => {
        const url = req.url();
        if (!m3u8Url && url.includes(`${EMBED_HOST}/hls/`)) {
          m3u8Url = url;
          print(`[DBG] intercepted hls URL: ${url.slice(0, 80)}…`, "info");
        }
      });

      await page.goto(embedUrl, {
        waitUntil: "networkidle",
        timeout: this.browserTimeout,
      });

      if (!m3u8Url) {
        await page.waitForTimeout(HLS_INTERCEPT_EXTRA_WAIT_MS);
      }

      if (!m3u8Url) {
        throw new Error(`Could not intercept /hls/ URL for: ${embedUrl}`);
      }

      return m3u8Url;
    } finally {
      await page.close();
    }
  }
}