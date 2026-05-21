import axios from "axios";
import * as cheerio from "cheerio";

/**
 * Handles all communication with the AnimeFox iframePlayer.php endpoint.
 * Responsible for: posting series selections and extracting embed iframe URLs.
 */
export class PlayerClient {
  /**
   * @param {{ baseUrl: string, iframePlayerUrl: string, ua: string }} options
   */
  constructor({ baseUrl, iframePlayerUrl, ua }) {
    this.baseUrl = baseUrl;
    this.iframePlayerUrl = iframePlayerUrl;
    this.ua = ua;
  }

  /**
   * Fetches the embed iframe src URL for a specific episode series.
   *
   * @param {string} postId
   * @param {number} series
   * @param {string} referer
   * @returns {Promise<string>} embed URL (e.g. https://x.tentacl.su/...)
   */
  async fetchEmbedUrl(postId, series, referer) {
    const data = await this.#post(postId, series, referer);

    const $ = cheerio.load(data.player || "");
    const src = $("iframe").attr("src");

    if (!src) {
      throw new Error(
        `No iframe src found in iframePlayer response (series=${series})`,
      );
    }

    return src;
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  /**
   * @param {string}      postId
   * @param {number|null} series  - null = initial request (no series selected)
   * @param {string}      referer
   * @returns {Promise<object>}
   */
  async #post(postId, series, referer) {
    const params = new URLSearchParams({ post_id: postId });
    if (series !== null) {
      params.append("select", `series=${series}`);
    }

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

    return data;
  }
}