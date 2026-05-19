/**
 * models/index.js — єдина точка імпорту всіх моделей.
 *
 * Тут:
 *  - реєструються всі моделі
 *  - описуються асоціації між ними
 *  - реекспортується все необхідне
 *
 * Використання:
 *   import { DownloadedEpisode, isDownloaded, markDownloaded } from "../models/index.js";
 */

import { DownloadedEpisode, isDownloaded, markDownloaded } from "./downloaded_episode.model.js";

// ─── Асоціації ────────────────────────────────────────────────────────────────
// Додавай сюди зв'язки між моделями коли з'являться нові:
//
// DownloadedEpisode.belongsTo(SomeModel, { foreignKey: "someId" });
// SomeModel.hasMany(DownloadedEpisode, { foreignKey: "someId" });

// ─── Єдиний реекспорт ─────────────────────────────────────────────────────────
export {
  DownloadedEpisode,
  isDownloaded,
  markDownloaded,
};