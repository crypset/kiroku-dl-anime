import { writeFile, mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { resolve, join } from "path";

import axios from "axios";
import * as cheerio from "cheerio";

import { BaseDownloader } from "../module/base.downloader.js";
import { Browser } from "../module/browser/browser.js";
import { isDownloaded, markDownloaded } from "../teapot/models/index.js";
import { sleep, print, ensureDir, sanitizeName } from "../shared/utils.js";

// ─── AnimeFoxDownloader ────────────────────────────────────────────────────────

/**
 * Downloads anime episodes from animefox.org.
 *
 * Flow per entry:
 *   1. GET anime page → extract post_id, title, description, poster URL
 *   2. POST iframePlayer.php (no select body) → get series count from <select>
 *   3. For each series: POST iframePlayer.php (select=series=N) → extract embed iframe src
 *   4. Open embed page (x.tentacl.su) in Playwright → wait for obfuscated JS to run
 *      → extract window vars (apx, qsx, ps, pd, kaken)
 *      → GET /api-config/ + POST /api/ via axios
 *      → decrypt CryptoJS AES response → extract /hls/ URL
 *      Fallback: intercept the /hls/ network request directly in the browser
 *   5. Download m3u8 segments → merge → save as .ts
 *   6. Optionally download poster
 */
export class AnimeFoxDownloader extends BaseDownloader {
  /** @type {Browser | null} */
  #browser = null;

  constructor(config) {
    super(config);
    this.ua = config.browser?.userAgent;

    const af = config.animefox;
    this.baseUrl = af.baseUrl;
    this.iframePlayerUrl = `${af.baseUrl}${af.iframePlayerPath}`;
    this.qualityOrder = af.qualityOrder;
  }

  // ─── Public API (BaseDownloader contract) ──────────────────────────────────

  async download(entry) {
    const { name, url } = entry;
    const useDb =
      this.config.database?.enabled && this.downloadConfig.useDatabase;
    const skipDownloaded =
      entry.skipDownloaded ?? this.downloadConfig.skipDownloaded ?? true;
    const skipErrors = this.downloadConfig.skipErrors ?? true;

    print(`[AnimeFox] Starting: ${name}`, "info");

    // Launch browser once for the entire download run
    this.#browser = await new Browser().launch();

    try {
      // 1. Parse anime page
      const animeData = await this.#fetchAnimePage(url, url);
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
        await this.#downloadPoster(animeData.posterUrl, outDir).catch(
          (error) =>
            print("[AnimeFox] Poster download failed — skipping", "warning"),
        );
      }

      // 4. Iterate series (episodes)
      for (let series = 1; series <= animeData.seriesCount; series++) {
        const episodeId = `ep-${series}`;
        const episodeTitle = `Episode ${series}`;

        // Skip if already in DB
        if (skipDownloaded && useDb && (await isDownloaded(name, episodeId))) {
          print(
            `[AnimeFox] Skip (already downloaded): ${episodeTitle}`,
            "info",
          );
          continue;
        }

        print(
          `[AnimeFox] Downloading ${episodeTitle} of "${safeTitle}"`,
          "info",
        );

        try {
          await this.downloadEpisode(
            { id: episodeId, number: series, title: episodeTitle },
            {
              ...entry,
              postId: animeData.postId,
              outDir,
              animeName: name,
              referer: url,
            },
          );

          if (useDb) {
            await markDownloaded(name, episodeId, episodeTitle);
          }
        } catch (error) {
          print(`[AnimeFox] Error on ${episodeTitle}: ${error.message}`, "error");
          console.log(error)
          if (!skipErrors) throw error;
        }

        await sleep(this.downloadConfig.delay ?? 1500);
      }

      print(`[AnimeFox] Done: ${name}`, "success");
    } finally {
      if (this.#browser) {
        await this.#browser.close();
        this.#browser = null;
      }
    }
  }

  async fetchEpisodeList(entry) {
    const animeData = await this.#fetchAnimePage(entry.url);
    const episodes = [];
    for (let i = 1; i <= animeData.seriesCount; i++) {
      episodes.push({
        id: `ep-${i}`,
        number: i,
        title: `Episode ${i}`,
        url: entry.url,
      });
    }
    return episodes;
  }

  async downloadEpisode(episode, entry) {
    const { postId, outDir, referer } = entry;
    const { number } = episode;

    // 1. Get embed URL for this series
    const embedUrl = await this.#fetchEmbedUrl(postId, number, referer);

    // 2. Get m3u8 playlist URL from embed page
    const m3u8Url = await this.#fetchM3u8Url(embedUrl);

    // 3. Fetch playlist and extract segment URLs
    const segments = await this.#fetchPlaylistSegments(m3u8Url);

    // 4. Download segments to a temp directory
    const epPrefix = `${String(number).padStart(2, "0")} - ${episode.title}`;
    const tmpDir = await mkdtemp(join(tmpdir(), "animefox-"));

    try {
      const segmentPaths = await this.#downloadSegments(segments, tmpDir);

      // 5. Merge via ffmpeg → .mp4
      const outFile = join(outDir, `${epPrefix}.mp4`);
      await this.#mergeSegments(segmentPaths, tmpDir, outFile);

      print(`[AnimeFox] Saved: ${outFile}`, "success");
    } finally {
      // Always clean up temp files, even on error
      await rm(tmpDir, { recursive: true, force: true });
    }
  }

  // ─── Private: page parsing ─────────────────────────────────────────────────

  async #fetchAnimePage(url, referer) {
    const html = await fetchText(url, this.ua, {
      Referer: referer,
    });

    const $ = cheerio.load(html);
    let postId =
      $('meta[property="ya:ovs:content_id"]').attr("content") ||
      $("#dle-content article [data-id]").first().attr("data-id");

    if (!postId) {
      throw new Error("Cannot extract post_id from page");
    }

    const title = $('meta[property="og:title"]').attr("content") || "";

    const descEl = $("#full_desc p").first().text().trim();
    const descMeta = $('meta[property="og:description"]').attr("content") || "";
    const description = descEl || descMeta;

    let posterUrl = null;
    const posterSrc = $("#full_poster div a img").attr("src");
    if (posterSrc) {
      const base = `${this.baseUrl}${posterSrc}`;
      posterUrl = base.replace(/\.webp$/, ".jpg");
    }

    const seriesCount = await this.#fetchSeriesCount(postId, url);

    return { postId, title, description, posterUrl, seriesCount };
  }

  async #fetchSeriesCount(postId, referer) {
    const data = await this.#iframePlayerPost(postId, null, referer);
    const $ = cheerio.load(data.selectors || "");
    const count = $('select[name="series"] option').length;
    return count > 0 ? count : 1;
  }

  async #fetchEmbedUrl(postId, series, referer) {
    const data = await this.#iframePlayerPost(postId, series, referer);

    const $ = cheerio.load(data.player || "");
    const src = $("iframe").attr("src");
    if (!src) {
      throw new Error(
        `No iframe src found in iframePlayer response (series=${series})`,
      );
    }
    return src;
  }

  async #iframePlayerPost(postId, series, referer) {
    const params = new URLSearchParams({ post_id: postId });
    if (series !== null) {
      params.append("select", `series=${series}`);
    }

    const { data } = await axios.post(this.iframePlayerUrl, params.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: referer,
        Origin: this.baseUrl,
        "User-Agent": this.ua,
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    return data;
  }

  // ─── Private: embed page → m3u8 ───────────────────────────────────────────

  /**
   * Main strategy:
   *   1. Extract window vars (apx, qsx, ps, pd, kaken) via Playwright
   *   2. GET /api-config/ + POST /api/ via axios
   *   3. Decrypt CryptoJS AES response → parse /hls/ URL
   *   Fallback: intercept /hls/ network request directly in Playwright
   */
  async #fetchM3u8Url(embedUrl) {
    // ── Strategy A: window vars + axios requests + decrypt ──
    try {
      const vars = await this.#extractWindowVars(embedUrl);
      print(
        `[DBG] window vars: ps=${vars.ps?.slice(0, 20)}... pd=${vars.pd} kaken=${vars.kaken?.slice(0, 20)}...`,
        "info",
      );

      // GET /api-config/
      const apiConfigUrl =
        `${Buffer.from(vars.apx, "base64").toString()}${vars.qsx}` +
        `?p=${vars.ps}&_=${vars.pd}`;
      print(`[DBG] api-config URL: ${apiConfigUrl.slice(0, 80)}...`, "info");

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
      const apiUrl = `https://x.tentacl.su/api/?p=${vars.ps}`;
      const { data: encryptedSources } = await axios.post(apiUrl, vars.kaken, {
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "Content-Type": "text/plain",
          Origin: "https://x.tentacl.su",
          "Referrer-Policy": "no-referrer",
          "User-Agent": this.ua,
        },
        responseType: "text",
      });
      print(
        `[DBG] api response (first 100): ${String(encryptedSources).slice(0, 100)}`,
        "info",
      );

      const m3u8Url = await this.#extractHlsUrl(
        encryptedConfig,
        encryptedSources,
        vars,
      );
      return m3u8Url;
    } catch (error) {
      print(
        `[AnimeFox] Strategy A failed (${error.message}), falling back to browser intercept`,
        "warning",
      );
      console.log(error)
    }

    // ── Strategy B (fallback): intercept /hls/ request in browser ──
    return this.#fetchM3u8UrlViaBrowser(embedUrl);
  }

  /**
   * Opens the embed page in Playwright, waits for the obfuscated JS to run,
   * and extracts the window-level variables the player sets.
   *
   * @param {string} embedUrl
   * @returns {Promise<{ apx: string, qsx: string, ps: string, pd: string, kaken: string }>}
   */
  async #extractWindowVars(embedUrl) {
    const page = await this.#browser.newPage();

    try {
      await page.goto(embedUrl, {
        waitUntil: "networkidle",
        timeout: this.config.browser?.timeout ?? 30_000,
      });

      // Wait until the obfuscated JS has written its vars into window
      await page.waitForFunction(() => window.ps && window.kaken, {
        timeout: 15_000,
      });

      const vars = await page.evaluate(() => ({
        ps: window.ps,
        pd: window.pd,
        apx: window.apx,
        qsx: window.qsx,
        kaken: window.kaken,
      }));

      return vars;
    } finally {
      await page.close();
    }
  }

  /**
   * Decrypts the CryptoJS AES-encrypted response from /api/ and extracts
   * the /hls/ master playlist URL.
   *
   * The player uses a static key ("localKey") that is also set on window
   * by the obfuscated JS. We try the known default first, then the key
   * from window vars if it was extracted.
   *
   * @param {string} encryptedConfig   - response from GET /api-config/
   * @param {string} encryptedSources  - response from POST /api/
   * @param {object} vars              - window vars (may include localKey)
   * @returns {Promise<string>}        - the /hls/ URL
   */
  async #extractHlsUrl(encryptedConfig, encryptedSources, vars) {
    // Dynamically import crypto-js so the rest of the module works
    // even if the package is not installed (fallback will kick in).
    let CryptoJS;
    try {
      ({ default: CryptoJS } = await import("crypto-js"));
    } catch {
      throw new Error("crypto-js not installed — run: npm install crypto-js");
    }

    // Keys to try, in order of likelihood
    const keyCandidates = [
      vars.localKey, // extracted from window (may be undefined)
      "8eeb24d0", // known default from deobfuscated source
    ].filter(Boolean);

    for (const key of keyCandidates) {
      try {
        const decrypted = CryptoJS.AES.decrypt(encryptedSources, key).toString(
          CryptoJS.enc.Utf8,
        );

        if (!decrypted) continue;

        // The decrypted payload may be raw JSON or contain the URL as a string
        let hlsUrl = null;

        try {
          const parsed = JSON.parse(decrypted);
          // Common shapes: { url: "..." } | { hls: "..." } | [ { file: "..." } ]
          hlsUrl =
            parsed?.url ||
            parsed?.hls ||
            parsed?.file ||
            (Array.isArray(parsed) && parsed[0]?.file) ||
            null;
        } catch {
          // Not JSON — search for a bare /hls/ URL
        }

        if (!hlsUrl) {
          const match = decrypted.match(/https?:\/\/[^\s"']+\/hls\/[^\s"']+/);
          hlsUrl = match?.[0] ?? null;
        }

        if (hlsUrl) {
          print(
            `[DBG] decrypted hls URL (key="${key}"): ${hlsUrl.slice(0, 80)}...`,
            "info",
          );
          return hlsUrl;
        }
      } catch {
        // Wrong key or corrupt payload — try next
      }
    }

    throw new Error("Could not decrypt /api/ response with any known key");
  }

  /**
   * Fallback: open the embed page in Playwright and intercept the /hls/ network
   * request that the player makes after it decrypts everything internally.
   *
   * @param {string} embedUrl
   * @returns {Promise<string>}
   */
  async #fetchM3u8UrlViaBrowser(embedUrl) {
    const page = await this.#browser.newPage();

    try {
      /** @type {string | null} */
      let m3u8Url = null;

      // Intercept all requests and capture the first /hls/ hit
      page.on("request", (req) => {
        const url = req.url();
        if (!m3u8Url && url.includes("x.tentacl.su/hls/")) {
          m3u8Url = url;
          print(`[DBG] intercepted hls URL: ${url.slice(0, 80)}...`, "info");
        }
      });

      await page.goto(embedUrl, {
        waitUntil: "networkidle",
        timeout: this.config.browser?.timeout ?? 30_000,
      });

      // Give the player a few more seconds if networkidle wasn't enough
      if (!m3u8Url) {
        await page.waitForTimeout(5_000);
      }

      if (!m3u8Url) {
        throw new Error(`Could not intercept /hls/ URL for: ${embedUrl}`);
      }

      return m3u8Url;
    } finally {
      await page.close();
    }
  }

  // ─── Private: m3u8 download ────────────────────────────────────────────────

  /**
   * Fetches the m3u8 playlist and returns the list of .ts segment URLs.
   * Handles master playlists (with quality variants) and media playlists.
   */
  async #fetchPlaylistSegments(m3u8Url) {
    const text = await fetchText(m3u8Url, this.ua, {
      "Referrer-Policy": "no-referrer",
    });

    if (text.includes("#EXT-X-STREAM-INF")) {
      const variantUrl = this.#pickBestVariant(text, m3u8Url);
      return this.#fetchPlaylistSegments(variantUrl);
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

    return segments;
  }

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
    return variants[0].url;
  }

  /**
   * Downloads all segments to a temp directory and returns their paths in order.
   * Writing to disk (instead of holding everything in memory) keeps RAM usage
   * flat regardless of episode length.
   *
   * @param {string[]} segments  - ordered list of .ts segment URLs
   * @param {string}   tmpDir    - temporary directory created by the caller
   * @returns {Promise<string[]>} - ordered list of absolute file paths
   */
  async #downloadSegments(segments, tmpDir) {
    const total = segments.length;
    const paths = [];

    for (let i = 0; i < total; i++) {
      const url = segments[i];
      const { data } = await axios.get(url, {
        responseType: "arraybuffer",
        headers: {
          "Referrer-Policy": "no-referrer",
          "User-Agent": this.ua,
        },
      });

      const segPath = join(tmpDir, `${String(i).padStart(6, "0")}.ts`);
      await writeFile(segPath, Buffer.from(data));
      paths.push(segPath);

      if (i % Math.max(1, Math.floor(total / 10)) === 0 || i === total - 1) {
        print(`[AnimeFox] Progress: ${i + 1}/${total} segments`, "info");
      }
    }

    return paths;
  }

  /**
   * Merges .ts segment files into a single .mp4 via ffmpeg.
   *
   * ffmpeg reads the concat list, remuxes (no re-encode: -c copy) and
   * moves the moov atom to the front (-movflags +faststart) so the file
   * is streamable before it finishes downloading.
   *
   * @param {string[]} segmentPaths - ordered list of temp .ts files
   * @param {string}   tmpDir       - directory where the concat list is written
   * @param {string}   outFile      - final .mp4 output path
   */
  async #mergeSegments(segmentPaths, tmpDir, outFile) {
    // ffmpeg concat demuxer needs a text file listing every segment
    const concatList = segmentPaths.map((p) => `file '${p}'`).join("\n");
    const listPath = join(tmpDir, "concat.txt");
    await writeFile(listPath, concatList, "utf-8");

    await this.#runFfmpeg([
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c",
      "copy", // remux only — no quality loss, very fast
      "-movflags",
      "+faststart",
      "-y", // overwrite without prompting
      outFile,
    ]);

    print(
      `[AnimeFox] Merged ${segmentPaths.length} segments → ${outFile}`,
      "info",
    );
  }

  /**
   * Spawns ffmpeg (bundled via ffmpeg-static) and waits for it to finish.
   * Throws a descriptive error (with the last stderr lines) if it exits non-zero.
   *
   * @param {string[]} args
   */
  async #runFfmpeg(args) {
    const [{ execa }, { default: ffmpegPath }] = await Promise.all([
      import("execa").catch(() => {
        throw new Error("execa not installed — run: npm install execa");
      }),
      import("ffmpeg-static").catch(() => {
        throw new Error(
          "ffmpeg-static not installed — run: npm install ffmpeg-static",
        );
      }),
    ]);

    if (!ffmpegPath || typeof ffmpegPath !== "string") {
      throw new Error(
        `ffmpeg-static повернув невалідний шлях: ${ffmpegPath}. ` +
          `Спробуй перевстановити: npm rebuild ffmpeg-static`,
      );
    }

    try {
      await execa(ffmpegPath, args, { all: true });
    } catch (error) {
      // err.all contains the interleaved stdout+stderr from ffmpeg
      const tail = (error.all ?? "").split("\n").slice(-10).join("\n");
      throw new Error(`ffmpeg failed:\n${tail}`);
    }
  }

  /**
   * Picks the best quality from a list of { url, quality } objects.
   */
  #pickBestQuality(variants) {
    for (const q of this.qualityOrder) {
      const match = variants.find((v) => v.quality === q);
      if (match) return match.url;
    }
    return variants[0].url;
  }

  // ─── Private: poster ───────────────────────────────────────────────────────

  async #downloadPoster(posterUrl, outDir) {
    const tryUrls = posterUrl.endsWith(".jpg")
      ? [posterUrl, posterUrl.replace(".jpg", ".webp")]
      : [posterUrl];

    for (const url of tryUrls) {
      try {
        const { data } = await axios.get(url, {
          responseType: "arraybuffer",
          headers: { Referer: this.baseUrl, "User-Agent": this.ua },
        });

        const ext = url.split(".").pop().split("?")[0] || "jpg";
        const outFile = join(outDir, `poster.${ext}`);
        await writeFile(outFile, Buffer.from(data));
        print(`[AnimeFox] Poster saved: ${outFile}`, "success");
        return;
      } catch {
        // try next
      }
    }

    throw new Error("All poster URL attempts failed");
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchText(url, ua, extraHeaders = {}) {
  const { data } = await axios.get(url, {
    headers: {
      "User-Agent": ua,
      ...extraHeaders,
    },
  });
  return typeof data === "string" ? data : JSON.stringify(data);
}
