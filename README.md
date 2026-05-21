# kiroku-dl-anime

## Project Structure

```
kiroku-dl-anime/
├─ .git/
├─ .gitignore
├─ config.example.json
├─ config.json
├─ LICENSE
├─ node_modules/
├─ package-lock.json
├─ package.json
├─ pot.sqlite
├─ README.md
├─ data/
├─ downloads/
├─ src/
│  ├─ config/
│  │  └─ app.config.js
│  ├─ index.js
│  ├─ module/
│  │  ├─ animefox/
│  │  │  ├─ animefox.downloader.js
│  │  │  ├─ embed.resolver.js
│  │  │  ├─ ffmpeg.merger.js
│  │  │  ├─ hls.downloader.js
│  │  │  ├─ index.js
│  │  │  ├─ page.parser.js
│  │  │  ├─ player.client.js
│  │  │  └─ poster.downloader.js
│  │  ├─ browser/
│  │  │  └─ browser.js
│  │  └─ downloader/
│  │     └─ base.downloader.js
│  ├─ orchestrator/
│  │  ├─ download.orchestrator.js
│  │  └─ module.resolver.js
│  ├─ shared/
│  │  └─ utils.js
│  └─ teapot/
│     ├─ models/
│     │  ├─ downloaded_episode.model.js
│     │  └─ index.js
│     └─ sqlite/
│        └─ sqlite_db.js
└─ test/
```
