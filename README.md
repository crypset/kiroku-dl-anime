# kiroku-dl-anime

## Структура проекту

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
├─ README.md
└─ src/
   ├─ config/
   │  └─ app.config.js
   ├─ index.js
   ├─ module/
   │  ├─ animefox.downloader.js
   │  ├─ base.downloader.js
   │  └─ browser/
   │     └─ browser.js
   ├─ orchestrator/
   │  ├─ download.orchestrator.js
   │  └─ module.resolver.js
   ├─ shared/
   │  └─ utils.js
   └─ teapot/
      ├─ models/
      │  ├─ downloaded_episode.model.js
      │  └─ index.js
      └─ sqlite/
         └─ sqlite_db.js
```
