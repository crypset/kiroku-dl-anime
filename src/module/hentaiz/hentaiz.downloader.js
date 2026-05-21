import axios from "axios";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { resolve, join, extname } from "path";

import { BaseDownloader } from "../downloader/base.downloader.js";
import { isDownloaded, markDownloaded } from "../../teapot/models/index.js";
import { sleep, print, ensureDir, sanitizeName } from "../../shared/utils.js";

import { PageParser } from "./page.parser.js";
import { VideoDownloader } from "./video.downloader.js";

/**
 * Downloads hentai episodes from hentaiz.org.
 *
 * Flow per entry:
 *   1. GET anime page → parse title, posterUrl, episodes[] via PageParser
 *   2. Prepare output directory
 *   3. Optionally download poster image
 *   4. For each episode in allData.subtitles[]:
 *        a. Build safe filename from episodeTitle + quality
 *        b. Stream-download .mp4 via VideoDownloader
 *
 * Config keys used (under config.hentaiz in config.json):
 *   baseUrl  (default: "https://hentaiz.org")
 *
 * Config keys used (under config.download):
 *   delay, skipErrors, skipDownloaded, useDatabase
 */
export class HentaizDownloader extends BaseDownloader {
  /** @type {PageParser} */
  #pageParser;

  /** @type {VideoDownloader} */
  #videoDownloader;

  constructor(config) {
    super(config);

    const hz = config.hentaiz ?? {};
    this.baseUrl = hz.baseUrl ?? "https://hentaiz.org";

    const shared = {
      ua: config.browser?.userAgent ?? "Mozilla/5.0",
    };

    this.#pageParser      = new PageParser(shared);
    this.#videoDownloader = new VideoDownloader(shared);
  }

  // ─── Public API (BaseDownloader contract) ───────────────────────────────────

  async download(entry) {
    const { name, url } = entry;
    const useDb          = this.config.database?.enabled && this.downloadConfig.useDatabase;
    const skipDownloaded = entry.skipDownloaded ?? this.downloadConfig.skipDownloaded ?? true;
    const skipErrors     = this.downloadConfig.skipErrors ?? true;

    print(`[Hentaiz] Starting: ${name}`, "info");

    // 1. Parse page
    const { title, posterUrl, episodes } = await this.#pageParser.parse(url);
    print(`[Hentaiz] title="${title}" | episodes=${episodes.length}`, "info");

    // 2. Prepare output directory
    const safeTitle = sanitizeName(title || name);
    const outDir    = resolve(this.downloadDir, safeTitle);
    await ensureDir(outDir);

    // 3. Download poster (best-effort)
    if (posterUrl) {
      await this.#downloadPoster(posterUrl, outDir);
    }

    // 4. Iterate episodes
    for (const episode of episodes) {
      const episodeId = sanitizeName(episode.episodeTitle);

      if (skipDownloaded && useDb && (await isDownloaded(name, episodeId))) {
        print(`[Hentaiz] Skip (already downloaded): ${episode.episodeTitle}`, "info");
        continue;
      }

      print(`[Hentaiz] Processing: ${episode.episodeTitle}`, "info");

      try {
        await this.downloadEpisode(episode, { ...entry, outDir, animeName: name });

        if (useDb) {
          await markDownloaded(name, episodeId, episode.episodeTitle);
        }
      } catch (error) {
        print(`[Hentaiz] Error on "${episode.episodeTitle}": ${error.message}`, "error");
        console.log(error);
        if (!skipErrors) throw error;
      }

      await sleep(this.downloadConfig.delay ?? 1500);
    }

    print(`[Hentaiz] Done: ${name}`, "success");
  }

  async fetchEpisodeList(entry) {
    const { episodes } = await this.#pageParser.parse(entry.url);
    return episodes.map((ep, i) => ({
      id:     sanitizeName(ep.episodeTitle),
      number: i + 1,
      title:  ep.episodeTitle,
      url:    ep.fileUrl,
    }));
  }

  async downloadEpisode(episode, entry) {
    const { outDir } = entry;

    // Build filename:  "1 серия [720p].mp4"
    const safeEpTitle = sanitizeName(episode.episodeTitle);
    const quality     = episode.quality !== "unknown" ? ` [${episode.quality}]` : "";
    const filename    = `${safeEpTitle}${quality}.mp4`;
    const outPath     = join(outDir, filename);

    await this.#videoDownloader.download(episode.fileUrl, outPath, `${safeEpTitle}${quality}`);
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  async #downloadPoster(posterUrl, outDir) {
    try {
      const ext      = extname(new URL(posterUrl).pathname) || ".jpg";
      const outPath  = join(outDir, `poster${ext}`);

      print(`[Hentaiz] Downloading poster`, "info");

      const response = await axios.get(posterUrl, {
        responseType: "stream",
        headers: {
          "User-Agent": "Mozilla/5.0",
          Referer: this.baseUrl + "/",
        },
      });

      const writer = createWriteStream(outPath);
      await pipeline(response.data, writer);

      print(`[Hentaiz] Poster saved: ${outPath}`, "success");
    } catch {
      print("[Hentaiz] Poster download failed — skipping", "warning");
    }
  }
}