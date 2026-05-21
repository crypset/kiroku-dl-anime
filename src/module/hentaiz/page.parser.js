import axios from "axios";
import * as cheerio from "cheerio";

/**
 * PageParser for hentaiz.org
 *
 * Extracts:
 *   - title    from  #full_title h1
 *   - posterUrl from  #full_poster img[src]
 *   - episodes  from  const allData = {...}  inline script
 *
 * Episode shape (from allData.subtitles[]):
 *   { title: '1 серия', file: '[720p]https://...mp4', audio: '', subtitle: '' }
 */
export class PageParser {
  /** @param {{ ua: string }} shared */
  constructor(shared) {
    this.ua = shared.ua ?? "Mozilla/5.0";
  }

  /**
   * @param {string} url
   * @returns {Promise<{ title: string, posterUrl: string|null, episodes: Array<{ episodeTitle: string, fileUrl: string, quality: string }> }>}
   */
  async parse(url) {
    const { data: html } = await axios.get(url, {
      headers: { "User-Agent": this.ua },
    });

    const $ = cheerio.load(html);

    // ── Title ────────────────────────────────────────────────────────────────
    const title = $("#full_title h1").first().text().trim() || "Unknown";

    // ── Poster ───────────────────────────────────────────────────────────────
    const posterUrl = $("#full_poster img").first().attr("src") ?? null;

    // ── allData (video sources) ───────────────────────────────────────────────
    const match = html.match(/const\s+allData\s*=\s*(\{[\s\S]*?\});/);
    if (!match) {
      throw new Error(`[HentaizParser] allData not found on page: ${url}`);
    }

    let allData;
    try {
      allData = JSON.parse(match[1]);
    } catch (err) {
      throw new Error(`[HentaizParser] Failed to parse allData JSON: ${err.message}`);
    }

    const subtitles = allData?.subtitles ?? [];
    if (subtitles.length === 0) {
      throw new Error(`[HentaizParser] No episodes found in allData.subtitles`);
    }

    // ── Normalise episodes ────────────────────────────────────────────────────
    // file format: '[720p]https://videos.hentaiz.org/...mp4'  OR  plain URL
    const episodes = subtitles.map((item, index) => {
      const raw = item.file ?? "";
      const qualityMatch = raw.match(/^\[([^\]]+)\]/);
      const quality = qualityMatch ? qualityMatch[1] : "unknown";
      const fileUrl = qualityMatch ? raw.slice(qualityMatch[0].length) : raw;

      return {
        episodeTitle: item.title?.trim() || `Episode ${index + 1}`,
        fileUrl,
        quality,
      };
    });

    return { title, posterUrl, episodes };
  }
}