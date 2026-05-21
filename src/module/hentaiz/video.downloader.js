import axios from "axios";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { print } from "../../shared/utils.js";

/**
 * VideoDownloader
 *
 * Downloads a direct .mp4 file via axios stream.
 * Logs progress every ~10% of total size (if Content-Length is available).
 */
export class VideoDownloader {
  /** @param {{ ua: string }} shared */
  constructor(shared) {
    this.ua = shared.ua ?? "Mozilla/5.0";
  }

  /**
   * @param {string} fileUrl   - Direct URL to the .mp4 file
   * @param {string} outPath   - Absolute path to write the file
   * @param {string} label     - Human-readable label for log output
   */
  async download(fileUrl, outPath, label = "video") {
    print(`[Hentaiz] Downloading: ${label}`, "info");

    const response = await axios.get(fileUrl, {
      responseType: "stream",
      headers: {
        "User-Agent": this.ua,
        Referer: "https://hentaiz.org/",
      },
    });

    const totalBytes = parseInt(response.headers["content-length"] ?? "0", 10);
    let downloadedBytes = 0;
    let lastLoggedPercent = -1;

    // Progress tracking
    response.data.on("data", (chunk) => {
      downloadedBytes += chunk.length;

      if (totalBytes > 0) {
        const percent = Math.floor((downloadedBytes / totalBytes) * 100);
        const milestone = Math.floor(percent / 10) * 10;

        if (milestone > lastLoggedPercent) {
          lastLoggedPercent = milestone;
          const mb = (downloadedBytes / 1024 / 1024).toFixed(1);
          const total = (totalBytes / 1024 / 1024).toFixed(1);
          print(`[Hentaiz] ${label} — ${percent}% (${mb} / ${total} MB)`, "data");
        }
      }
    });

    const writer = createWriteStream(outPath);
    await pipeline(response.data, writer);

    print(`[Hentaiz] Saved: ${outPath}`, "success");
  }
}