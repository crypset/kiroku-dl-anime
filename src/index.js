import { loadConfig } from "./config/app.config.js";
import { initializeDatabase, closeDatabase } from "./teapot/sqlite/sqlite_db.js";
import { DownloadOrchestrator } from "./orchestrator/download.orchestrator.js";
import { banner, print } from "./shared/utils.js";

class Kiroku {
  constructor() {
    this.config = null;
    this.orchestrator = null;
  }

  async main() {
    banner("KIROKU", "anime download engine v1.0.0");

    // 1. Load config
    try {
      this.config = await loadConfig();
      print("Config loaded", "system");
    } catch (err) {
      print(`Failed to load config: ${err.message}`, "error");
      process.exit(1);
    }

    // 2. Init DB (if enabled)
    if (this.config.database?.enabled) {
      try {
        const dbOk = await initializeDatabase();
        if (!dbOk) {
          print("Database init failed — continuing without DB", "warning");
          this.config.database.enabled = false;
        }
      } catch (err) {
        print(`Database error: ${err.message} — continuing without DB`, "warning");
        this.config.database.enabled = false;
      }
    }

    // 3. Run downloads
    try {
      this.orchestrator = new DownloadOrchestrator(this.config);
      await this.orchestrator.run();
    } catch (err) {
      print(`Download orchestrator failed: ${err.message}`, "error");
    } finally {
      // 4. Cleanup — завжди виконується
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
}

const kiroku = new Kiroku();
kiroku.main();