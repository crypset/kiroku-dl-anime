# Kiroku DL Anime

Kiroku DL Anime is a modular Node.js download engine for anime-style video sites.
It reads a list of configured entries from `config.json`, resolves each URL to the
correct site module, downloads episodes into local folders, saves posters when
available, and optionally records downloaded episodes in SQLite so repeated runs
can skip already completed work.

The project is intentionally module-based: each supported website owns its own
parser and downloader logic, while the application core handles configuration,
module resolution, orchestration, logging, database setup, and backup/import of
download history.

## Features

- Modular downloader architecture under `src/module/<site>/`.
- Supported modules:
  - `animefox` for `animefox.org`
  - `hentaiz` for `hentaiz.org`
- Poster downloading into each anime output folder.
- Stable episode filenames with numeric prefixes.
- Optional SQLite download history.
- `skipDownloaded` support through the database.
- JSON export/import backup system for downloaded episode history.
- Shared module-development rules in `docs/module-development-rules.md`.

## Requirements

- Node.js with ES module support.
- npm.
- Internet access for the target sites.
- A valid `config.json` in the project root.

Install dependencies:

```bash
npm install
```

## Quick Start

1. Copy the example config:

```bash
cp config.example.json config.json
```

On Windows PowerShell:

```powershell
Copy-Item config.example.json config.json
```

2. Edit `config.json` and add entries to `searches`.

3. Start the downloader:

```bash
npm start
```

Downloaded files are written to the configured `app.downloadDir`, which defaults
to `downloads`.

## Commands

```bash
npm start
```

Runs the normal download pipeline.

```bash
npm run backup:export
```

Exports downloaded episode history to `data/export/export_<timestamp>.json`.

```bash
npm run backup:import
```

Imports downloaded episode history from `data/import/import.json` and merges it
with existing database records.

```bash
npm run backup:import:clean
```

Deletes all current downloaded episode records first, then imports
`data/import/import.json`.

## Configuration

Kiroku loads `config.json` from the project root through
`src/config/app.config.js`. The loader validates `searches`, applies defaults,
and passes the normalized config into the orchestrator and modules.

Minimal example:

```json
{
  "app": {
    "downloadDir": "downloads"
  },
  "browser": {
    "headless": true,
    "viewport": {
      "width": 1280,
      "height": 720
    },
    "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "timeout": 30000
  },
  "download": {
    "delay": 4000,
    "searchDelay": 6000,
    "skipErrors": true,
    "skipDownloaded": true,
    "useDatabase": true
  },
  "database": {
    "enabled": true,
    "sync": true
  },
  "searches": [
    {
      "name": "Example Anime",
      "url": "https://www.animefox.org/example.html",
      "skipDownloaded": true
    }
  ]
}
```

### Main Config Sections

`app`

- `downloadDir`: root folder for downloaded anime folders. Defaults to
  `downloads`.

`browser`

- Used by modules that need Playwright browser automation, especially AnimeFox
  embed/HLS resolution.
- `userAgent` is also passed to HTTP download helpers.

`download`

- `delay`: delay between episodes.
- `searchDelay`: delay between configured search entries.
- `skipErrors`: when `true`, log an entry/episode error and continue.
- `skipDownloaded`: when `true`, skip episodes already present in the database.
- `useDatabase`: enables DB-backed downloaded checks when `database.enabled` is
  also true.

`database`

- `enabled`: controls whether SQLite is initialized for normal downloads.
- The database file is `pot.sqlite` in the project root.

`searches`

- Required array of download targets.
- Every entry must include `name` and `url`.
- `skipDownloaded` can be overridden per entry.

Site-specific defaults currently include:

```js
animefox: {
  baseUrl: "https://www.animefox.org",
  iframePlayerPath: "/engine/ajax/iframePlayer.php",
  qualityOrder: ["1080p", "720p", "480p", "360p", "240p"],
  concurrency: 8
}
```

```js
hentaiz: {
  baseUrl: "https://hentaiz.org"
}
```

## How The Download Pipeline Works

1. `src/index.js` starts the app and loads `config.json`.
2. If the command is a backup command, it initializes the database and runs the
   backup import/export flow.
3. For normal downloads, the database is initialized when enabled.
4. `DownloadOrchestrator` iterates through `config.searches`.
5. For each entry, `module.resolver.js` picks a downloader by URL hostname.
6. The selected module parses page metadata, prepares the output folder, downloads
   the poster if available, and downloads episodes.
7. After a successful episode download, the module marks it as downloaded in
   SQLite when DB tracking is enabled.
8. The app sleeps between episodes and between search entries according to config.

## Output Layout

Downloads are grouped by parsed title:

```text
downloads/
  Anime Title/
    poster.jpg
    01 - Episode 1 [720p].mp4
    02 - Episode 2 [720p].mp4
```

Rules:

- Folder names use the parsed site title, falling back to the config entry name.
- Folder and file names are sanitized by `sanitizeName`.
- Episode files should start with a zero-padded episode number.
- Quality is appended in square brackets when known.

## Database And Download History

Downloaded episodes are stored in SQLite through Sequelize in the
`downloaded_episodes` table.

Columns:

- `animeName`: the `name` from the config entry.
- `episodeId`: stable source episode ID, such as `ep-1`.
- `episodeTitle`: human-readable episode title.
- `downloadedAt`: timestamp.

The unique key is:

```text
animeName + episodeId
```

This allows safe `upsert` behavior and makes repeated runs idempotent when
`skipDownloaded` is enabled.

## Backup And Restore

The backup system only exports/imports downloaded episode history. It does not
copy video files or posters.

Export:

```bash
npm run backup:export
```

Creates:

```text
data/export/export_<timestamp>.json
```

Import merge mode:

```bash
npm run backup:import
```

Reads:

```text
data/import/import.json
```

Merge mode keeps existing rows and upserts imported rows by
`animeName + episodeId`.

Clean import:

```bash
npm run backup:import:clean
```

Clean mode deletes all current `downloaded_episodes` rows before importing.

More detail: `docs/downloaded-episodes-backup.md`.

## Module Overview

### AnimeFox

Path: `src/module/animefox`

AnimeFox uses a multi-step HLS pipeline:

1. `page.parser.js` extracts page metadata, poster URL, post ID, and episode
   count.
2. `player.client.js` calls the site's iframe player endpoint for each episode.
3. `embed.resolver.js` resolves the embed/player page into an HLS playlist URL.
4. `hls.downloader.js` fetches the playlist and downloads transport stream
   segments.
5. `ffmpeg.merger.js` merges segments into a final `.mp4`.
6. `poster.downloader.js` saves the poster into the anime output folder.

Temporary HLS segment files are written under `data/temp` and removed after
merge.

### Hentaiz

Path: `src/module/hentaiz`

Hentaiz uses a direct-video pipeline:

1. `page.parser.js` parses title, poster URL, and `allData.subtitles`.
2. Episode URLs and poster URLs are normalized to absolute URLs.
3. `poster.downloader.js` saves the poster.
4. `video.downloader.js` streams direct `.mp4` files to disk.

Hentaiz episode IDs are stable numeric IDs (`ep-1`, `ep-2`, etc.) and filenames
use the same stable numbering style as other modules.

## Project Structure

```text
kiroku-dl-anime/
  config.example.json
  config.json
  package.json
  pot.sqlite
  README.md
  data/
    export/
    import/
    temp/
  docs/
    downloaded-episodes-backup.md
    module-development-rules.md
  downloads/
  src/
    config/
      app.config.js
    index.js
    module/
      animefox/
      browser/
      downloader/
      hentaiz/
    orchestrator/
      download.orchestrator.js
      module.resolver.js
    shared/
      utils.js
    teapot/
      backup/
      models/
      sqlite/
  test/
```

## Important Source Files

- `src/index.js`: application entry point and CLI command router.
- `src/config/app.config.js`: config loading, validation, defaults, and shared
  constants.
- `src/orchestrator/download.orchestrator.js`: iterates configured searches.
- `src/orchestrator/module.resolver.js`: maps URLs to downloader modules.
- `src/module/downloader/base.downloader.js`: base downloader contract.
- `src/shared/utils.js`: logging, sleeps, directory creation, filename
  sanitization.
- `src/teapot/sqlite/sqlite_db.js`: SQLite/Sequelize initialization.
- `src/teapot/models/downloaded_episode.model.js`: downloaded episode model and
  helper functions.
- `src/teapot/backup/downloaded_episode.backup.js`: JSON export/import for
  downloaded history.

## Adding A New Module

Use `docs/module-development-rules.md` as the source of truth. The short version:

1. Create `src/module/<site>/`.
2. Add `<site>.downloader.js`, `page.parser.js`, `poster.downloader.js`, and any
   media-specific helpers.
3. Export the public downloader from `src/module/<site>/index.js`.
4. Add default config in `src/config/app.config.js`.
5. Register the module in `src/orchestrator/module.resolver.js`.
6. Return normalized parser data: title, poster URL, and episodes with stable
   `ep-N` IDs and 1-based `number`.
7. Use stable filenames like `01 - Episode title [720p].mp4`.
8. Run `node --check` for changed files.

## Troubleshooting

If downloads repeat every run:

- Confirm `database.enabled` is `true`.
- Confirm `download.useDatabase` is `true`.
- Confirm modules use stable `episode.id` values.

If posters are missing:

- Check whether the parser returns a normalized absolute `posterUrl`.
- Check site headers and referer requirements.
- Poster download failures are non-fatal and logged as warnings.

If a site URL is ignored:

- Check `src/orchestrator/module.resolver.js`.
- Make sure the URL hostname matches a registry entry.

If import fails:

- Put the file at `data/import/import.json`.
- Confirm it has a `records` array.
- Use clean import only when the import file is the full source of truth.

## Notes

This project is built for personal archival workflows. Site structures and player
APIs can change, so individual modules may need maintenance over time. Keep new
module behavior aligned with `docs/module-development-rules.md` so naming,
posters, download history, and backup behavior stay consistent across sites.
