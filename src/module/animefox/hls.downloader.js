import { writeFile } from "fs/promises";
import { join } from "path";

import axios from "axios";

import { print } from "../../shared/utils.js";

/**
 * Handles fetching m3u8 playlists (master + media) and downloading
 * individual .ts segments to disk.
 */
export class HlsDownloader {
  /**
   * @param {{ ua: string, qualityOrder: string[] }} options
   */
  constructor({ ua, qualityOrder }) {
    this.ua = ua;
    this.qualityOrder = qualityOrder;
  }

  /**
   * Fetches the m3u8 playlist and returns the ordered list of segment URLs
   * together with the chosen video height.
   *
   * Handles both master playlists (with quality variants) and media playlists.
   *
   * @param {string} m3u8Url
   * @returns {Promise<{ segments: string[], height: number }>}
   */
  async fetchSegments(m3u8Url) {
    return this.#fetchPlaylist(m3u8Url, 0);
  }

  /**
   * Downloads all segments in order to `tmpDir`.
   * Writing to disk (instead of buffering everything in RAM) keeps memory
   * usage flat regardless of episode length.
   *
   * @param {string[]} segments - ordered list of .ts segment URLs
   * @param {string}   tmpDir   - temporary directory created by the caller
   * @returns {Promise<string[]>} ordered list of absolute segment file paths
   */
  async downloadSegments(segments, tmpDir) {
    const total = segments.length;
    const paths = [];

    for (let i = 0; i < total; i++) {
      const { data } = await axios.get(segments[i], {
        responseType: "arraybuffer",
        headers: {
          "Referrer-Policy": "no-referrer",
          "User-Agent": this.ua,
        },
      });

      const segPath = join(tmpDir, `${String(i).padStart(6, "0")}.ts`);
      await writeFile(segPath, Buffer.from(data));
      paths.push(segPath);

      const logStep = Math.max(1, Math.floor(total / 10));
      if (i % logStep === 0 || i === total - 1) {
        print(`[AnimeFox] Progress: ${i + 1}/${total} segments`, "info");
      }
    }

    return paths;
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  /**
   * Recursively resolves a playlist URL to its media segments.
   * On a master playlist it selects the best quality variant and recurses.
   *
   * @param {string} m3u8Url
   * @param {number} selectedHeight - height carried from master-level selection
   * @returns {Promise<{ segments: string[], height: number }>}
   */
  async #fetchPlaylist(m3u8Url, selectedHeight) {
    const text = await this.#fetchText(m3u8Url);

    if (text.includes("#EXT-X-STREAM-INF")) {
      const { url: variantUrl, height } = this.#pickBestVariant(text, m3u8Url);
      return this.#fetchPlaylist(variantUrl, height);
    }

    const base = m3u8Url.substring(0, m3u8Url.lastIndexOf("/") + 1);
    const segments = [];

    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      segments.push(trimmed.startsWith("http") ? trimmed : `${base}${trimmed}`);
    }

    if (segments.length === 0) {
      throw new Error("m3u8 playlist has no segments");
    }

    return { segments, height: selectedHeight };
  }

  /**
   * Parses a master playlist and returns the URL + height of the best variant.
   * "Best" is defined by the highest resolution available.
   *
   * @param {string} masterText
   * @param {string} masterUrl
   * @returns {{ url: string, height: number }}
   */
  #pickBestVariant(masterText, masterUrl) {
    const base = masterUrl.substring(0, masterUrl.lastIndexOf("/") + 1);
    const lines = masterText.split("\n");
    const variants = [];

    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith("#EXT-X-STREAM-INF")) continue;
      const urlLine = lines[i + 1]?.trim();
      if (!urlLine) continue;

      const resMatch = lines[i].match(/RESOLUTION=\d+x(\d+)/);
      const height = resMatch ? parseInt(resMatch[1], 10) : 0;
      const variantUrl = urlLine.startsWith("http")
        ? urlLine
        : `${base}${urlLine}`;

      variants.push({ url: variantUrl, height });
    }

    if (variants.length === 0) {
      throw new Error("No variants found in master playlist");
    }

    variants.sort((a, b) => b.height - a.height);
    return variants[0];
  }

  async #fetchText(url) {
    const { data } = await axios.get(url, {
      headers: {
        "Referrer-Policy": "no-referrer",
        "User-Agent": this.ua,
      },
    });
    return typeof data === "string" ? data : JSON.stringify(data);
  }
}