import { ZipArchive } from "archiver";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { AppError } from "./errors.js";
import type { DownloadedFile } from "./download.js";

/** Builds a single zip artifact from the given files (streaming) and resolves with its size in bytes. */
export async function buildArchive(files: readonly DownloadedFile[], artifactPath: string): Promise<number> {
  if (files.length === 0) {
    throw new AppError("Cannot build an artifact: no files were successfully downloaded", 500, "UNIFICATION_FAILED");
  }

  await mkdir(path.dirname(artifactPath), { recursive: true });

  return new Promise<number>((resolve, reject) => {
    let settled = false;
    const settleOnce = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const output = createWriteStream(artifactPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    output.on("close", () => settleOnce(() => resolve(archive.pointer())));
    output.on("error", (error) =>
      settleOnce(() => reject(new AppError(`Failed to write artifact: ${error.message}`, 500, "UNIFICATION_FAILED")))
    );
    archive.on("error", (error) =>
      settleOnce(() => reject(new AppError(`Failed to build archive: ${error.message}`, 500, "UNIFICATION_FAILED")))
    );
    // archiver treats a missing source file as a mere "warning" and would otherwise finalize a
    // silently incomplete zip; since only successfully-downloaded files ever reach this point,
    // any warning here indicates a real problem and must fail loudly instead.
    archive.on("warning", (warning: Error) =>
      settleOnce(() => reject(new AppError(`Failed to build archive: ${warning.message}`, 500, "UNIFICATION_FAILED")))
    );

    archive.pipe(output);
    for (const file of files) {
      archive.file(file.localPath, { name: file.entry.fileName });
    }
    void archive.finalize();
  });
}
