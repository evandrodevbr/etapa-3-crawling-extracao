import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline as streamPipeline } from "node:stream/promises";
import { resolveSafeJoin } from "./security.js";
import type { FileEntry } from "./extract.js";

export interface DownloadedFile {
  readonly entry: FileEntry;
  readonly localPath: string;
  readonly bytes: number;
}

export interface DownloadFailure {
  readonly entry: FileEntry;
  readonly reason: string;
}

/** Streams one file to disk with a hard timeout, cleaning up any partial file on failure. */
export async function downloadFile(entry: FileEntry, targetDir: string, timeoutMs: number): Promise<DownloadedFile> {
  const localPath = resolveSafeJoin(targetDir, entry.fileName);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(entry.url, { signal: controller.signal, redirect: "follow" });
    if (!response.ok || !response.body) {
      throw new Error(`File responded with status ${response.status}`);
    }
    await streamPipeline(Readable.fromWeb(response.body as never), createWriteStream(localPath));
    const { size } = await stat(localPath);
    return { entry, localPath, bytes: size };
  } catch (error) {
    await rm(localPath, { force: true });
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Timed out downloading ${entry.url} after ${timeoutMs}ms`);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to download ${entry.url}: ${message}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs `fn` over every item with at most `limit` in flight at once. Bounding concurrency protects
 * both the remote server and this process from being overwhelmed by a large file listing.
 */
async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const currentIndex = nextIndex++;
      if (currentIndex >= items.length) return;
      try {
        results[currentIndex] = { status: "fulfilled", value: await fn(items[currentIndex] as T) };
      } catch (error) {
        results[currentIndex] = { status: "rejected", reason: error };
      }
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

/**
 * Downloads every entry with bounded concurrency. A failing file is recorded in `failed` and
 * never aborts the others.
 */
export async function downloadAll(
  entries: readonly FileEntry[],
  targetDir: string,
  concurrency: number,
  timeoutMs: number
): Promise<{ succeeded: DownloadedFile[]; failed: DownloadFailure[] }> {
  await mkdir(targetDir, { recursive: true });

  const results = await mapWithConcurrency(entries, concurrency, (entry) => downloadFile(entry, targetDir, timeoutMs));

  const succeeded: DownloadedFile[] = [];
  const failed: DownloadFailure[] = [];

  results.forEach((result, index) => {
    const entry = entries[index] as FileEntry;
    if (result.status === "fulfilled") {
      succeeded.push(result.value);
      return;
    }
    const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
    console.warn(`Download failed for ${entry.fileCode} (${entry.url}): ${reason}`);
    failed.push({ entry, reason });
  });

  return { succeeded, failed };
}
