import { writeFile } from "fs/promises";
import { join } from "path";

import axios from "axios";

import { print } from "../../shared/utils.js";

/**
 * Downloads the anime poster image to the output directory.
 * Tries the primary URL first (.jpg), then falls back to .webp if needed.
 */
export class PosterDownloader {
  /**
   * @param {{ baseUrl: string, ua: string }} options
   */
  constructor({ baseUrl, ua }) {
    this.baseUrl = baseUrl;
    this.ua = ua;
  }

  /**
   * Downloads the poster to `outDir`.
   * Throws if all URL candidates fail.
   *
   * @param {string} posterUrl
   * @param {string} outDir
   */
  async download(posterUrl, outDir) {
    const candidates = posterUrl.endsWith(".jpg")
      ? [posterUrl, posterUrl.replace(".jpg", ".webp")]
      : [posterUrl];

    for (const url of candidates) {
      try {
        const { data } = await axios.get(url, {
          responseType: "arraybuffer",
          headers: {
            Referer: this.baseUrl,
            "User-Agent": this.ua,
          },
        });

        const ext = url.split(".").pop().split("?")[0] || "jpg";
        const outFile = join(outDir, `poster.${ext}`);
        await writeFile(outFile, Buffer.from(data));
        print(`[AnimeFox] Poster saved: ${outFile}`, "success");
        return;
      } catch {
        // try next candidate
      }
    }

    throw new Error("All poster URL attempts failed");
  }
}