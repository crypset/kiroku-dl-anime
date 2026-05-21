/**
 * Public API of the `hentaiz` module.
 *
 * Consumers should import from this file only — internal sub-modules
 * (page.parser, video.downloader) are implementation details and
 * may change without notice.
 *
 * @example
 * import { HentaizDownloader } from '../module/hentaiz/index.js';
 */
export { HentaizDownloader } from "./hentaiz.downloader.js";