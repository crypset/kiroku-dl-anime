/**
 * Public API of the `animefox` module.
 *
 * Consumers should import from this file only — internal sub-modules
 * (page.parser, player.client, embed.resolver, hls.downloader,
 * ffmpeg.merger, poster.downloader) are implementation details and
 * may change without notice.
 *
 * @example
 * import { AnimeFoxDownloader } from '../module/animefox/index.js';
 */
export { AnimeFoxDownloader } from "./animefox.downloader.js";