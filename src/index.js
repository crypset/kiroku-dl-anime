import { loadConfig } from "./config/app.config.js";
import { initializeDatabase, closeDatabase } from "./teapot/sqlite/sqlite_db.js";
import { DownloadOrchestrator } from "./orchestrator/download.orchestrator.js";
import { banner, print } from "./shared/utils.js";
import {
  exportDownloadedEpisodes,
  importDownloadedEpisodes,
} from "./teapot/backup/downloaded_episode.backup.js";

class Kiroku {
  constructor() {
    this.config = null;
    this.orchestrator = null;
  }

  async main() {
    banner("KIROKU", "anime download engine v1.0.0");

    const command = process.argv[2] ?? "download";
    const flags = new Set(process.argv.slice(3));

    try {
      this.config = await loadConfig();
      print("Config loaded", "system");
    } catch (err) {
      print(`Failed to load config: ${err.message}`, "error");
      process.exit(1);
    }

    if (this.#isBackupCommand(command)) {
      await this.#runBackupCommand(command, flags);
      return;
    }

    if (this.config.database?.enabled) {
      await this.#initDatabaseForDownload();
    }

    try {
      this.orchestrator = new DownloadOrchestrator(this.config);
      await this.orchestrator.run();
    } catch (err) {
      print(`Download orchestrator failed: ${err.message}`, "error");
    } finally {
      await this.disconnect();
    }
  }

  async disconnect() {
    if (this.config?.database?.enabled) {
      try {
        await closeDatabase();
      } catch (err) {
        print(`Error closing database: ${err.message}`, "error");
      }
    }
    print("Kiroku finished", "success");
  }

  async #runBackupCommand(command, flags) {
    const dbOk = await initializeDatabase();
    if (!dbOk) {
      print("Database init failed", "error");
      process.exitCode = 1;
      return;
    }

    this.config.database.enabled = true;

    try {
      if (command === "backup:export") {
        await exportDownloadedEpisodes();
        return;
      }

      if (command === "backup:import") {
        await importDownloadedEpisodes({
          clean: flags.has("--clean") || flags.has("-c"),
        });
      }
    } catch (err) {
      print(`Backup command failed: ${err.message}`, "error");
      process.exitCode = 1;
    } finally {
      await this.disconnect();
    }
  }

  async #initDatabaseForDownload() {
    try {
      const dbOk = await initializeDatabase();
      if (!dbOk) {
        print("Database init failed - continuing without DB", "warning");
        this.config.database.enabled = false;
      }
    } catch (err) {
      print(`Database error: ${err.message} - continuing without DB`, "warning");
      this.config.database.enabled = false;
    }
  }

  #isBackupCommand(command) {
    return command === "backup:export" || command === "backup:import";
  }
}

const kiroku = new Kiroku();
kiroku.main();
