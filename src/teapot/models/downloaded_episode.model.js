import { DataTypes } from "sequelize";
import { sequelize } from "../sqlite/sqlite_db.js";

/**
 * DownloadedEpisode — tracks every successfully downloaded episode.
 *
 * Columns:
 *   id           - auto-increment PK
 *   animeName    - name from config.searches entry
 *   episodeId    - unique ID from the source site (e.g. "ep-1", "chapter-42")
 *   episodeTitle - human-readable title
 *   downloadedAt - timestamp
 */
export const DownloadedEpisode = sequelize.define(
  "DownloadedEpisode",
  {
    animeName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    episodeId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    episodeTitle: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    downloadedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "downloaded_episodes",
    indexes: [
      {
        unique: true,
        fields: ["animeName", "episodeId"],
      },
    ],
  }
);

// ─── Helper functions ─────────────────────────────────────────────────────────

/**
 * Check if an episode was already downloaded.
 * Returns true / false. Safe to call even if DB is not enabled.
 */
export async function isDownloaded(animeName, episodeId) {
  try {
    const row = await DownloadedEpisode.findOne({
      where: { animeName, episodeId },
    });
    return !!row;
  } catch {
    return false;
  }
}

/**
 * Mark an episode as downloaded.
 * Upserts so it's safe to call multiple times.
 */
export async function markDownloaded(animeName, episodeId, episodeTitle = null) {
  try {
    await DownloadedEpisode.upsert({ animeName, episodeId, episodeTitle });
  } catch {
    // Non-fatal
  }
}