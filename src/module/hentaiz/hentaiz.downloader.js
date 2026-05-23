import { resolve, join } from "path";

import { BaseDownloader } from "../downloader/base.downloader.js";
import { isDownloaded, markDownloaded } from "../../teapot/models/index.js";
import { sleep, print, ensureDir, sanitizeName } from "../../shared/utils.js";

import { PageParser } from "./page.parser.js";
import { VideoDownloader } from "./video.downloader.js";
import { PosterDownloader } from "./poster.downloader.js";

/**
 * Downloads hentai episodes from hentaiz.org.
 *
 * Flow per entry:
 *   1. GET anime page -> parse title, posterUrl, episodes[] via PageParser
 *   2. Prepare output directory
 *   3. Optionally download poster image
 *   4. For each episode in allData.subtitles[]:
 *        a. Build stable filename from episode number + title + quality
 *        b. Stream-download .mp4 via VideoDownloader
 */
export class HentaizDownloader extends BaseDownloader {
  /** @type {PageParser} */
  #pageParser;

  /** @type {VideoDownloader} */
  #videoDownloader;

  /** @type {PosterDownloader} */
  #posterDownloader;

  constructor(config) {
    super(config);

    const hz = config.hentaiz ?? {};
    this.baseUrl = hz.baseUrl ?? "https://hentaiz.org";

    const shared = {
      baseUrl: this.baseUrl,
      ua: config.browser?.userAgent ?? "Mozilla/5.0",
    };

    this.#pageParser = new PageParser(shared);
    this.#videoDownloader = new VideoDownloader(shared);
    this.#posterDownloader = new PosterDownloader(shared);
  }

  async download(entry) {
    const { name, url } = entry;
    const useDb = this.config.database?.enabled && this.downloadConfig.useDatabase;
    const skipDownloaded = entry.skipDownloaded ?? this.downloadConfig.skipDownloaded ?? true;
    const skipErrors = this.downloadConfig.skipErrors ?? true;

    print(`[Hentaiz] Starting: ${name}`, "info");

    const { title, posterUrl, episodes } = await this.#pageParser.parse(url);
    print(`[Hentaiz] title="${title}" | episodes=${episodes.length}`, "info");

    const safeTitle = sanitizeName(title || name);
    const outDir = resolve(this.downloadDir, safeTitle);
    await ensureDir(outDir);

    if (posterUrl) {
      try {
        await this.#posterDownloader.download(posterUrl, outDir);
      } catch {
        print("[Hentaiz] Poster download failed - skipping", "warning");
      }
    }

    for (const episode of episodes) {
      const episodeId = episode.id;

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
    return episodes.map((ep) => ({
      id: ep.id,
      number: ep.number,
      title: ep.episodeTitle,
      url: ep.fileUrl,
    }));
  }

  async downloadEpisode(episode, entry) {
    const { outDir } = entry;
    const number = episode.number ?? 1;
    const quality = episode.quality !== "unknown" ? ` [${episode.quality}]` : "";
    const epPrefix = sanitizeName(
      `${String(number).padStart(2, "0")} - ${episode.episodeTitle}${quality}`,
    );
    const outPath = join(outDir, `${epPrefix}.mp4`);

    await this.#videoDownloader.download(episode.fileUrl, outPath, epPrefix);
  }
}
