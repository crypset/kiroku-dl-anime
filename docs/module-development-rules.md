# Module Development Rules

This document is the stable checklist for adding or fixing downloader modules.
Use `src/module/animefox` as the reference implementation for structure and flow.

## Module Structure

Each site module must live in `src/module/<site>/` and expose only its public downloader through `index.js`.

Recommended files:

```text
src/module/<site>/
  index.js
  <site>.downloader.js
  page.parser.js
  poster.downloader.js
  video.downloader.js       # direct video files, if used
  hls.downloader.js         # HLS segments, if used
  embed.resolver.js         # embed/player pages, if used
```

Keep the main downloader as an orchestrator. Site-specific parsing, poster download, video download, HLS logic, and embed resolving should live in dedicated files.

## Config Rules

Every module must support a `baseUrl` config section in `src/config/app.config.js`.

Example:

```js
hentaiz: {
  baseUrl: "https://hentaiz.org",
  ...config.hentaiz,
}
```

Pass shared values into submodules instead of hardcoding them:

```js
const shared = {
  baseUrl: this.baseUrl,
  ua: config.browser?.userAgent ?? "Mozilla/5.0",
};
```

## Page Parser Rules

`page.parser.js` must return normalized metadata:

```js
{
  title,
  posterUrl,
  episodes: [
    {
      id: "ep-1",
      number: 1,
      episodeTitle: "Episode 1",
      fileUrl,
      quality,
    },
  ],
}
```

Rules:

- Prefer site title from visible page content, then fallback to `og:title`, then `"Unknown"`.
- Normalize all poster and video URLs with `new URL(value, pageUrl || baseUrl).toString()`.
- Support common lazy-image attributes for posters: `src`, `data-src`, `data-original`, then fallback to `og:image`.
- Never return raw relative paths from a parser.
- Episode IDs must be stable numeric IDs like `ep-1`, `ep-2`; do not base DB IDs on translated titles or site text.
- Episode numbers must be 1-based and stored as `number`.

## Folder Naming

The output folder name must be based on parsed site title, with config entry name as fallback:

```js
const safeTitle = sanitizeName(title || entry.name);
const outDir = resolve(this.downloadDir, safeTitle);
await ensureDir(outDir);
```

Always use `sanitizeName` for folder names.

## Episode File Naming

Episode files must use a stable numeric prefix:

```js
const quality = episode.quality !== "unknown" ? ` [${episode.quality}]` : "";
const epPrefix = sanitizeName(
  `${String(episode.number).padStart(2, "0")} - ${episode.episodeTitle}${quality}`,
);
const outPath = join(outDir, `${epPrefix}.mp4`);
```

Expected examples:

```text
01 - Episode 1 [720p].mp4
02 - Episode 2 [1080p].mp4
```

Rules:

- Always prefix with a zero-padded episode number.
- Always sanitize the full filename prefix.
- Include quality in square brackets when known.
- Do not use only site-provided title as the filename; it can be unstable or duplicated.

## Poster Download Rules

Every module that can parse a poster must have a `poster.downloader.js`.

Rules:

- Use `arraybuffer` and `writeFile` for posters.
- Save as `poster.<ext>` or `poster<ext>` consistently inside that module.
- Derive extension from the final URL path, fallback to `.jpg`.
- Pass `Referer` and `User-Agent` headers.
- Poster download is best-effort: log a warning and continue if it fails.

Downloader flow:

```js
if (posterUrl) {
  try {
    await this.#posterDownloader.download(posterUrl, outDir);
  } catch {
    print("[Site] Poster download failed - skipping", "warning");
  }
}
```

## Download And DB Rules

Use the same skip/download/mark flow in every module:

```js
const useDb = this.config.database?.enabled && this.downloadConfig.useDatabase;
const skipDownloaded = entry.skipDownloaded ?? this.downloadConfig.skipDownloaded ?? true;
const skipErrors = this.downloadConfig.skipErrors ?? true;
```

Rules:

- Check `isDownloaded(entry.name, episode.id)` before downloading.
- Mark with `markDownloaded(entry.name, episode.id, episode.episodeTitle)` only after a successful download.
- Respect `skipErrors`: continue when true, throw when false.
- Sleep between episodes using `this.downloadConfig.delay ?? 1500`.

## Headers And URLs

Rules:

- Do not hardcode site URLs in submodules.
- Use `this.baseUrl` for `Referer` and `Origin`.
- Use configured browser user agent where possible.
- Normalize direct media URLs before download.
- Keep page URL as referer when a site requires it.

## Module Registration

After adding a new module:

1. Export it from `src/module/<site>/index.js`.
2. Import it in `src/orchestrator/module.resolver.js`.
3. Add a hostname matcher to `REGISTRY`.
4. Add default config in `src/config/app.config.js`.
5. Add an example search entry to `config.example.json` only when useful.

## Verification Checklist

Before considering a module done:

- Run `node --check` for every changed `.js` file.
- Confirm parser returns title, posterUrl, and normalized episode URLs.
- Confirm output folder uses parsed title fallback to config name.
- Confirm filenames are stable and start with `01 -`, `02 -`, etc.
- Confirm poster is saved into the anime output folder.
- Confirm DB skip uses stable `ep-N` IDs.
- Confirm failures respect `skipErrors`.

