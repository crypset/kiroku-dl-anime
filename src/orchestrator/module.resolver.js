import { AnimeFoxDownloader } from "../module/animefox/index.js";
// Import new modules here as you add them:
// import { AnotherSiteDownloader } from "../module/anothersite/anothersite.downloader.js";

/**
 * Registry maps URL hostname patterns to downloader constructors.
 *
 * To add a new site:
 *   1. Create src/module/<sitename>/<sitename>.downloader.js
 *   2. Import it above
 *   3. Add an entry to REGISTRY below
 */
const REGISTRY = [
  {
    match: (url) => url.includes("animefox.org"),
    createDownloader: (config) => new AnimeFoxDownloader(config),
  },
  // {
  //   match: (url) => url.includes("anothersite.com"),
  //   createDownloader: (config) => new AnotherSiteDownloader(config),
  // },
];

/**
 * Returns an instantiated downloader for the given URL,
 * or null if no module matches.
 *
 * @param {string} url
 * @param {object} config  - full app config passed down to each downloader
 * @returns {BaseDownloader|null}
 */
export function resolveModule(url, config) {
  const entry = REGISTRY.find((r) => r.match(url));
  if (!entry) return null;
  return entry.createDownloader(config);
}