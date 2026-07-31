import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntry } from "./extract.js";
import { downloadAll, downloadFile } from "./download.js";

function makeEntry(fileCode: string, overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    listingCode: "0001",
    displayName: `Arquivo ${fileCode}`,
    fileCode,
    url: `http://example.test/${fileCode}.pdf`,
    fileName: `${fileCode}.pdf`,
    ...overrides
  };
}

describe("downloadFile", () => {
  let targetDir: string;

  beforeEach(() => {
    targetDir = mkdtempSync(path.join(tmpdir(), "dl-test-"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(targetDir, { recursive: true, force: true });
  });

  it("streams a successful response body to disk and reports its size", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("hello world", { status: 200 })));

    const entry = makeEntry("AAA");
    const result = await downloadFile(entry, targetDir, 1000);

    expect(readFileSync(result.localPath, "utf-8")).toBe("hello world");
    expect(result.bytes).toBe(Buffer.byteLength("hello world"));
  });

  it("rejects and leaves no file behind on a non-2xx response or a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("broken link", { status: 404 })));
    const entryA = makeEntry("AAA");
    await expect(downloadFile(entryA, targetDir, 1000)).rejects.toThrow();
    expect(existsSync(path.join(targetDir, entryA.fileName))).toBe(false);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNRESET");
      })
    );
    const entryB = makeEntry("BBB");
    await expect(downloadFile(entryB, targetDir, 1000)).rejects.toThrow();
    expect(existsSync(path.join(targetDir, entryB.fileName))).toBe(false);
  });

  it("aborts and cleans up when the download exceeds the timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, options: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener("abort", () => {
              const abortError = new Error("aborted");
              abortError.name = "AbortError";
              reject(abortError);
            });
          })
      )
    );

    const entry = makeEntry("AAA");
    await expect(downloadFile(entry, targetDir, 10)).rejects.toThrow(/Timed out/);
    expect(existsSync(path.join(targetDir, entry.fileName))).toBe(false);
  });

  it("cleans up a partial file when the response stream errors mid-transfer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("partial-bytes"));
            controller.error(new Error("connection reset"));
          }
        });
        return new Response(stream, { status: 200 });
      })
    );

    const entry = makeEntry("AAA");
    await expect(downloadFile(entry, targetDir, 1000)).rejects.toThrow();
    expect(existsSync(path.join(targetDir, entry.fileName))).toBe(false);
  });

  it("never escapes the target directory even if fileName sanitization were bypassed upstream", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 200 })));
    const entry = makeEntry("AAA", { fileName: "../escaped.pdf" });
    await expect(downloadFile(entry, targetDir, 1000)).rejects.toThrow(/escapes target directory/);
  });
});

describe("downloadAll", () => {
  let targetDir: string;

  beforeEach(() => {
    targetDir = path.join(mkdtempSync(path.join(tmpdir(), "dlall-")), "nested", "downloads");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(targetDir, { recursive: true, force: true });
  });

  it("creates missing parent directories and returns an empty summary for an empty entry list", async () => {
    const summary = await downloadAll([], targetDir, 4, 1000);
    expect(summary).toEqual({ succeeded: [], failed: [] });
    expect(existsSync(targetDir)).toBe(true);
  });

  it("isolates a failing download: it is recorded in `failed` while others still succeed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (url.includes("BBB") ? new Response("nope", { status: 404 }) : new Response("ok", { status: 200 })))
    );

    const entries = [makeEntry("AAA"), makeEntry("BBB"), makeEntry("CCC")];
    const summary = await downloadAll(entries, targetDir, 4, 1000);

    expect(summary.succeeded.map((f) => f.entry.fileCode)).toEqual(["AAA", "CCC"]);
    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0]?.entry.fileCode).toBe("BBB");
  });

  it("never runs more downloads concurrently than the configured limit", async () => {
    let active = 0;
    let maxActive = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return new Response("ok", { status: 200 });
      })
    );

    const entries = Array.from({ length: 8 }, (_unused, i) => makeEntry(`F${i}`));
    await downloadAll(entries, targetDir, 3, 1000);

    expect(maxActive).toBeLessThanOrEqual(3);
  });
});
