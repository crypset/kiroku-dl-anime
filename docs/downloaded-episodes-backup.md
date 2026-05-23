# Downloaded Episodes Backup

Kiroku stores downloaded episode history in the `downloaded_episodes` database table.
This history controls `skipDownloaded`, so it should be backed up before moving the app,
recreating the database, or doing a clean reinstall.

## Export

Run:

```bash
npm run backup:export
```

This creates:

```text
data/export/export_<timestamp>.json
```

The export file contains:

```json
{
  "schema": "kiroku.downloaded_episodes",
  "version": 1,
  "exportedAt": "2026-05-22T00:00:00.000Z",
  "count": 1,
  "records": [
    {
      "animeName": "Example Anime",
      "episodeId": "ep-1",
      "episodeTitle": "Episode 1",
      "downloadedAt": "2026-05-22T00:00:00.000Z"
    }
  ]
}
```

## Import

Place the file to import here:

```text
data/import/import.json
```

Then run:

```bash
npm run backup:import
```

Default import mode is merge:

- existing database rows are kept;
- imported rows are added;
- matching rows are updated by `animeName + episodeId`;
- nothing is deleted.

## Clean Import

Run:

```bash
npm run backup:import:clean
```

or:

```bash
npm run backup:import -- --clean
```

Clean import first deletes all existing `downloaded_episodes` rows, then imports
everything from `data/import/import.json`.

Use clean import only when the import file is the full source of truth.

