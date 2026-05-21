import { writeFile } from "fs/promises";
import { join } from "path";

import { execa } from "execa";
import ffmpegPath from "ffmpeg-static";

import { print } from "../../shared/utils.js";

/**
 * Merges downloaded .ts segment files into a single .mp4 via ffmpeg.
 * Uses the concat demuxer (no re-encode) for speed and zero quality loss.
 */
export class FfmpegMerger {
  /**
   * Merges .ts segment files into a single .mp4.
   *
   * ffmpeg reads the concat list, remuxes with `-c copy` (no re-encode) and
   * moves the moov atom to the front (`-movflags +faststart`) so the file
   * is streamable immediately.
   *
   * @param {string[]} segmentPaths - ordered list of absolute .ts file paths
   * @param {string}   tmpDir       - directory where the concat list is written
   * @param {string}   outFile      - final .mp4 output path
   */
  async merge(segmentPaths, tmpDir, outFile) {
    const listPath = await this.#writeConcatList(segmentPaths, tmpDir);

    await this.#runFfmpeg([
      "-f", "concat",
      "-safe", "0",
      "-i", listPath,
      "-c", "copy",          // remux only — no quality loss, very fast
      "-movflags", "+faststart",
      "-y",                  // overwrite without prompting
      outFile,
    ]);

    print(
      `[AnimeFox] Merged ${segmentPaths.length} segments → ${outFile}`,
      "info",
    );
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  /**
   * Writes an ffmpeg concat demuxer list file and returns its path.
   *
   * @param {string[]} segmentPaths
   * @param {string}   tmpDir
   * @returns {Promise<string>} path to the written list file
   */
  async #writeConcatList(segmentPaths, tmpDir) {
    const content = segmentPaths.map((p) => `file '${p}'`).join("\n");
    const listPath = join(tmpDir, "concat.txt");
    await writeFile(listPath, content, "utf-8");
    return listPath;
  }

  /**
   * Spawns ffmpeg (bundled via ffmpeg-static) and waits for it to finish.
   * Throws a descriptive error (with the last 10 stderr lines) on non-zero exit.
   *
   * @param {string[]} args
   */
  async #runFfmpeg(args) {
    if (!ffmpegPath || typeof ffmpegPath !== "string") {
      throw new Error(
        `ffmpeg-static повернув невалідний шлях: ${ffmpegPath}. ` +
          `Спробуй перевстановити: npm rebuild ffmpeg-static`,
      );
    }

    try {
      await execa(ffmpegPath, args, { all: true });
    } catch (error) {
      const tail = (error.all ?? "").split("\n").slice(-10).join("\n");
      throw new Error(`ffmpeg failed:\n${tail}`);
    }
  }
}