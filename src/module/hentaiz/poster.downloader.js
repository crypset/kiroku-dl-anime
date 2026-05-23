import { writeFile } from "fs/promises";
import { extname, join } from "path";

import axios from "axios";

import { print } from "../../shared/utils.js";

/**
 * Downloads the Hentaiz poster image to the output directory.
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
   * @param {string} posterUrl
   * @param {string} outDir
   */
  async download(posterUrl, outDir) {
    const url = new URL(posterUrl, this.baseUrl).toString();

    const { data } = await axios.get(url, {
      responseType: "arraybuffer",
      headers: {
        Referer: this.baseUrl,
        "User-Agent": this.ua,
      },
    });

    const ext = extname(new URL(url).pathname) || ".jpg";
    const outFile = join(outDir, `poster${ext}`);

    await writeFile(outFile, Buffer.from(data));
    print(`[Hentaiz] Poster saved: ${outFile}`, "success");
  }
}
