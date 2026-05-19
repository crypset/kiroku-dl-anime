import { print, sleep } from "../shared/utils.js";
import { resolveModule } from "./module.resolver.js";

/**
 * DownloadOrchestrator iterates over config.searches
 * and delegates each entry to the correct downloader module.
 */
export class DownloadOrchestrator {
  constructor(config) {
    this.config = config;
    this.searches = config.searches ?? [];
    this.downloadConfig = config.download ?? {};
  }

  async run() {
    if (this.searches.length === 0) {
      print("No searches configured — nothing to do", "warning");
      return;
    }

    print(`Starting — ${this.searches.length} search(es) queued`, "info");

    for (const entry of this.searches) {
      await this._processEntry(entry);

      const delay = this.downloadConfig.searchDelay ?? 3000;
      await sleep(delay);
    }

    print("All entries processed", "success");
  }

  async _processEntry(entry) {
    print(`Processing: ${entry.name}`, "data");

    const downloader = resolveModule(entry.url, this.config);

    if (!downloader) {
      print(`No module found for URL: ${entry.url}`, "warning");
      return;
    }

    try {
      await downloader.download(entry);
    } catch (error) {
      if (this.downloadConfig.skipErrors) {
        print(`Error processing "${entry.name}": ${error.message}`, "error");
        console.log(error)
      } else {
        // Перекидаємо вище — main() вже обробить
        throw error;
      }
    }
  }
}