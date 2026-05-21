import { mkdir, rm } from "fs/promises";
import { resolve, join } from "path";

import { BaseDownloader } from "../downloader/base.downloader.js";
import { Browser } from "../browser/browser.js";
import { isDownloaded, markDownloaded } from "../../teapot/models/index.js";
import { sleep, print, ensureDir, sanitizeName } from "../../shared/utils.js";
import { TEMP_DIR } from "../../config/app.config.js";

import { PageParser } from "./page.parser.js";
import { PlayerClient } from "./player.client.js";
import { EmbedResolver } from "./embed.resolver.js";
import { HlsDownloader } from "./hls.downloader.js";
import { FfmpegMerger } from "./ffmpeg.merger.js";
import { PosterDownloader } from "./poster.downloader.js";

/**
 * Downloads anime episodes from animefox.org.
 *
 * This class is a thin orchestrator — all domain logic lives in dedicated
 * sub-modules that are composed here:
 *
 *   PageParser      — scrapes the anime landing page (postId, title, seriesCount…)
 *   PlayerClient    — communicates with iframePlayer.php to obtain embed URLs
 *   EmbedResolver   — extracts the HLS playlist URL from the embed page
 *   HlsDownloader   — fetches m3u8 manifests and downloads .ts segments
 *   FfmpegMerger    — merges segments into a final .mp4
 *   PosterDownloader— saves the poster image
 *
 * Flow per entry:
 *   1. Parse anime page → postId, title, seriesCount, posterUrl
 *   2. Prepare output directory + optionally download poster
 *   3. For each episode:
 *        a. POST iframePlayer.php → embed iframe URL
 *        b. Resolve embed page → HLS (.m3u8) URL
 *        c. Fetch playlist → segment URLs
 *        d. Download segments → merge → save .mp4
 */
export class AnimeFoxDownloader extends BaseDownloader {
  /** @type {Browser | null} */
  #browser = null;

  /** @type {PageParser} */      #pageParser;
  /** @type {PlayerClient} */    #playerClient;
  /** @type {HlsDownloader} */   #hlsDownloader;
  /** @type {FfmpegMerger} */    #ffmpegMerger;
  /** @type {PosterDownloader} */#posterDownloader;

  constructor(config) {
    super(config);

    this.ua = config.browser?.userAgent;

    const af = config.animefox;
    this.baseUrl = af.baseUrl;
    this.iframePlayerUrl = `${af.baseUrl}${af.iframePlayerPath}`;
    this.qualityOrder = af.qualityOrder;
    this.concurrency = af.concurrency ?? 8;

    const shared = {
      baseUrl: this.baseUrl,
      iframePlayerUrl: this.iframePlayerUrl,
      ua: this.ua,
      qualityOrder: this.qualityOrder,
      concurrency: this.concurrency,
    };

    this.#pageParser       = new PageParser(shared);
    this.#playerClient     = new PlayerClient(shared);
    this.#hlsDownloader    = new HlsDownloader(shared);
    this.#ffmpegMerger     = new FfmpegMerger();
    this.#posterDownloader = new PosterDownloader(shared);
  }

  // ─── Public API (BaseDownloader contract) ───────────────────────────────────

  async download(entry) {
    const { name, url } = entry;
    const useDb = this.config.database?.enabled && this.downloadConfig.useDatabase;
    const skipDownloaded = entry.skipDownloaded ?? this.downloadConfig.skipDownloaded ?? true;
    const skipErrors = this.downloadConfig.skipErrors ?? true;

    print(`[AnimeFox] Starting: ${name}`, "info");

    this.#browser = await new Browser().launch();

    try {
      // 1. Parse anime page
      const animeData = await this.#pageParser.parse(url, url);
      print(
        `[AnimeFox] post_id=${animeData.postId} | series=${animeData.seriesCount} | title="${animeData.title}"`,
        "info",
      );

      // 2. Prepare output directory
      const safeTitle = sanitizeName(animeData.title || name);
      const outDir = resolve(this.downloadDir, safeTitle);
      await ensureDir(outDir);

      // 3. Optionally download poster
      if (animeData.posterUrl) {
        try {
          await this.#posterDownloader.download(animeData.posterUrl, outDir);
        } catch {
          print("[AnimeFox] Poster download failed — skipping", "warning");
        }
      }

      // 4. Iterate episodes
      for (let series = 1; series <= animeData.seriesCount; series++) {
        const episode = {
          id: `ep-${series}`,
          number: series,
          title: `Episode ${series}`,
        };

        if (skipDownloaded && useDb && (await isDownloaded(name, episode.id))) {
          print(`[AnimeFox] Skip (already downloaded): ${episode.title}`, "info");
          continue;
        }

        print(`[AnimeFox] Downloading ${episode.title} of "${safeTitle}"`, "info");

        try {
          await this.downloadEpisode(episode, {
            ...entry,
            postId: animeData.postId,
            outDir,
            animeName: name,
            referer: url,
          });

          if (useDb) {
            await markDownloaded(name, episode.id, episode.title);
          }
        } catch (error) {
          print(`[AnimeFox] Error on ${episode.title}: ${error.message}`, "error");
          console.log(error);
          if (!skipErrors) throw error;
        }

        await sleep(this.downloadConfig.delay ?? 1500);
      }

      print(`[AnimeFox] Done: ${name}`, "success");
    } finally {
      await this.#closeBrowser();
    }
  }

  async fetchEpisodeList(entry) {
    const animeData = await this.#pageParser.parse(entry.url);
    return Array.from({ length: animeData.seriesCount }, (_, i) => ({
      id: `ep-${i + 1}`,
      number: i + 1,
      title: `Episode ${i + 1}`,
      url: entry.url,
    }));
  }

  async downloadEpisode(episode, entry) {
    const { postId, outDir, referer } = entry;
    const { number } = episode;

    // Lazy-launch browser if called standalone (outside download())
    const ownBrowser = !this.#browser;
    if (ownBrowser) {
      this.#browser = await new Browser().launch();
    }

    try {
      // 1. Get embed URL for this series
      const embedUrl = await this.#playerClient.fetchEmbedUrl(postId, number, referer);

      // 2. Resolve embed page → m3u8 URL
      const resolver = new EmbedResolver({
        browser: this.#browser,
        ua: this.ua,
        browserTimeout: this.config.browser?.timeout ?? 30_000,
      });
      const m3u8Url = await resolver.resolve(embedUrl);

      // 3. Fetch playlist segments
      const { segments, height } = await this.#hlsDownloader.fetchSegments(m3u8Url);

      // 4. Build output path
      const qualityTag = height > 0 ? ` [${height}p]` : "";
      const epPrefix = `${String(number).padStart(2, "0")} - ${episode.title}${qualityTag}`;
      const tmpDir = join(TEMP_DIR, `animefox-${Date.now()}`);
      await mkdir(tmpDir, { recursive: true });

      try {
        // 5. Download segments
        const segmentPaths = await this.#hlsDownloader.downloadSegments(segments, tmpDir);

        // 6. Merge → .mp4
        const outFile = join(outDir, `${epPrefix}.mp4`);
        await this.#ffmpegMerger.merge(segmentPaths, tmpDir, outFile);

        print(`[AnimeFox] Saved: ${outFile}`, "success");
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    } finally {
      if (ownBrowser) {
        await this.#closeBrowser();
      }
    }
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  async #closeBrowser() {
    if (this.#browser) {
      await this.#browser.close();
      this.#browser = null;
    }
  }
}