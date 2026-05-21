import axios from "axios";
import * as cheerio from "cheerio";

/**
 * Responsible for parsing the AnimeFox anime page HTML and extracting
 * structured metadata: postId, title, description, posterUrl, seriesCount.
 */
export class PageParser {
  /**
   * @param {{ baseUrl: string, iframePlayerUrl: string, ua: string }} options
   */
  constructor({ baseUrl, iframePlayerUrl, ua }) {
    this.baseUrl = baseUrl;
    this.iframePlayerUrl = iframePlayerUrl;
    this.ua = ua;
  }

  /**
   * Fetches and parses the anime landing page.
   *
   * @param {string} url
   * @param {string} [referer]
   * @returns {Promise<{ postId: string, title: string, description: string, posterUrl: string|null, seriesCount: number }>}
   */
  async parse(url, referer) {
    const html = await this.#fetchText(url, { Referer: referer });
    const $ = cheerio.load(html);

    const postId =
      $('meta[property="ya:ovs:content_id"]').attr("content") ||
      $("#dle-content article [data-id]").first().attr("data-id");

    if (!postId) {
      throw new Error("Cannot extract post_id from page");
    }

    const title = $('meta[property="og:title"]').attr("content") || "";

    const descEl = $("#full_desc p").first().text().trim();
    const descMeta = $('meta[property="og:description"]').attr("content") || "";
    const description = descEl || descMeta;

    const posterUrl = this.#extractPosterUrl($);
    const seriesCount = await this.#fetchSeriesCount(postId, url);

    return { postId, title, description, posterUrl, seriesCount };
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  #extractPosterUrl($) {
    const posterSrc = $("#full_poster div a img").attr("src");
    if (!posterSrc) return null;
    const base = `${this.baseUrl}${posterSrc}`;
    return base.replace(/\.webp$/, ".jpg");
  }

  /**
   * POSTs iframePlayer.php without a series selection to read the <select>
   * element and determine how many episodes exist.
   *
   * @param {string} postId
   * @param {string} referer
   * @returns {Promise<number>}
   */
  async #fetchSeriesCount(postId, referer) {
    const params = new URLSearchParams({ post_id: postId });

    const { data } = await axios.post(
      this.iframePlayerUrl,
      params.toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: referer,
          Origin: this.baseUrl,
          "User-Agent": this.ua,
          "X-Requested-With": "XMLHttpRequest",
        },
      },
    );

    const $ = cheerio.load(data.selectors || "");
    const count = $('select[name="series"] option').length;
    return count > 0 ? count : 1;
  }

  async #fetchText(url, extraHeaders = {}) {
    const { data } = await axios.get(url, {
      headers: { "User-Agent": this.ua, ...extraHeaders },
    });
    return typeof data === "string" ? data : JSON.stringify(data);
  }
}