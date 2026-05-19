/**
 * BaseDownloader — every site module must extend this class.
 *
 * Contract:
 *   - download(entry)        → main entry point called by orchestrator
 *   - fetchEpisodeList(entry) → returns array of episode objects
 *   - downloadEpisode(episode, entry) → downloads a single episode
 *
 * Config shape passed in constructor:
 * {
 *   app:      { downloadDir },
 *   download: { delay, pageDelay, maxConcurrent, skipErrors, skipDownloaded, useDatabase },
 * }
 */
export class BaseDownloader {
  constructor(config) {
    this.config = config;
    this.downloadDir    = config.app?.downloadDir ?? "downloads";
    this.downloadConfig = config.download ?? {};
  }

  /**
   * Main method called by the orchestrator.
   * @param {object} entry - single item from config.searches
   */
  async download(entry) {
    throw new Error(`${this.constructor.name} must implement download()`);
  }

  /**
   * Fetch the full list of episodes for the given entry.
   * @param {object} entry
   * @returns {Promise<Array<{id: string, title: string, url: string, number: number}>>}
   */
  async fetchEpisodeList(entry) {
    throw new Error(`${this.constructor.name} must implement fetchEpisodeList()`);
  }

  /**
   * Download a single episode to disk.
   * @param {object} episode - one item returned by fetchEpisodeList
   * @param {object} entry   - parent search entry (for folder naming etc.)
   */
  async downloadEpisode(episode, entry) {
    throw new Error(`${this.constructor.name} must implement downloadEpisode()`);
  }
}