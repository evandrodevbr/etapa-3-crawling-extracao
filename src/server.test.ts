import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "./env.js";
import { extractFiles } from "./extract.js";
import { downloadAll } from "./download.js";
import { buildArchive } from "./unify.js";
import { createServer } from "./server.js";

vi.mock("./extract.js", () => ({ extractFiles: vi.fn() }));
vi.mock("./download.js", () => ({ downloadAll: vi.fn() }));
vi.mock("./unify.js", () => ({ buildArchive: vi.fn() }));

const ENTRY = { listingCode: "0001", displayName: "Arquivo A", fileCode: "AAA", url: "http://example.test/AAA.pdf", fileName: "AAA.pdf" };
const DOWNLOADED = { entry: ENTRY, localPath: "/tmp/AAA.pdf", bytes: 10 };

function json(response: Response): Promise<any> {
  return response.json();
}

function makeConfig(artifactPath: string): AppConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    targetUrl: "http://example.test/teste3/",
    targetOrigin: "http://example.test",
    downloadsDir: path.dirname(artifactPath) + "/downloads",
    artifactPath,
    pageFetchTimeoutMs: 1000,
    fileDownloadTimeoutMs: 1000,
    downloadConcurrency: 4
  };
}

async function withServer<T>(config: AppConfig, run: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = createServer(config);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("HTTP server", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), "http-test-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("GET /health returns 200 without touching the pipeline", async () => {
    await withServer(makeConfig(path.join(workDir, "artifact.zip")), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/health`);
      expect(response.status).toBe(200);
      expect(await json(response)).toEqual({ status: "ok" });
      expect(extractFiles).not.toHaveBeenCalled();
    });
  });

  it("GET / redirects to /health instead of 404ing", async () => {
    await withServer(makeConfig(path.join(workDir, "artifact.zip")), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/`, { redirect: "manual" });
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/health");
    });
  });

  it("returns 404 NOT_FOUND for an unknown route", async () => {
    await withServer(makeConfig(path.join(workDir, "artifact.zip")), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/nope`);
      expect(response.status).toBe(404);
      expect((await json(response)).error).toBe("NOT_FOUND");
    });
  });

  it("POST /process returns 200 with the aggregated summary on success", async () => {
    vi.mocked(extractFiles).mockResolvedValueOnce([ENTRY]);
    vi.mocked(downloadAll).mockResolvedValueOnce({ succeeded: [DOWNLOADED], failed: [] });
    vi.mocked(buildArchive).mockResolvedValueOnce(999);

    await withServer(makeConfig(path.join(workDir, "artifact.zip")), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/process`, { method: "POST" });
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({
        filesFound: 1,
        filesDownloaded: 1,
        filesFailed: 0,
        artifactBytes: 999,
        files: [{ name: ENTRY.displayName, code: ENTRY.fileCode, url: ENTRY.url }]
      });
    });
  });

  it("POST /process reports partial download failures in the summary", async () => {
    const failedEntry = { ...ENTRY, fileCode: "BBB" };
    vi.mocked(extractFiles).mockResolvedValueOnce([ENTRY, failedEntry]);
    vi.mocked(downloadAll).mockResolvedValueOnce({ succeeded: [DOWNLOADED], failed: [{ entry: failedEntry, reason: "404 not found" }] });
    vi.mocked(buildArchive).mockResolvedValueOnce(123);

    await withServer(makeConfig(path.join(workDir, "artifact.zip")), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/process`, { method: "POST" });
      const body = await json(response);
      expect(body.filesFailed).toBe(1);
      expect(body.failures).toEqual([{ fileCode: "BBB", url: failedEntry.url, reason: "404 not found" }]);
    });
  });

  it("maps a known AppError (e.g. extraction failure) to its declared status code", async () => {
    const { AppError } = await import("./errors.js");
    vi.mocked(extractFiles).mockRejectedValueOnce(new AppError("Timed out fetching target page", 502, "EXTRACTION_FAILED"));

    await withServer(makeConfig(path.join(workDir, "artifact.zip")), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/process`, { method: "POST" });
      expect(response.status).toBe(502);
      expect(await json(response)).toEqual({ error: "EXTRACTION_FAILED", message: "Timed out fetching target page" });
    });
  });

  it("maps the all-downloads-failed case (buildArchive's own guard) to a 500 with a safe message", async () => {
    const { AppError } = await import("./errors.js");
    vi.mocked(extractFiles).mockResolvedValueOnce([ENTRY]);
    vi.mocked(downloadAll).mockResolvedValueOnce({ succeeded: [], failed: [{ entry: ENTRY, reason: "timeout" }] });
    vi.mocked(buildArchive).mockRejectedValueOnce(new AppError("Cannot build an artifact: no files were successfully downloaded", 500, "UNIFICATION_FAILED"));

    await withServer(makeConfig(path.join(workDir, "artifact.zip")), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/process`, { method: "POST" });
      expect(response.status).toBe(500);
      expect((await json(response)).error).toBe("UNIFICATION_FAILED");
    });
  });

  it("returns a generic 500 for an unexpected error, hiding the original message", async () => {
    vi.mocked(extractFiles).mockRejectedValueOnce(new Error("password=hunter2 leaked internal detail"));

    await withServer(makeConfig(path.join(workDir, "artifact.zip")), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/process`, { method: "POST" });
      const bodyText = await response.text();
      expect(response.status).toBe(500);
      expect(bodyText).not.toContain("hunter2");
      expect(JSON.parse(bodyText)).toEqual({ error: "INTERNAL_ERROR", message: "An unexpected error occurred." });
    });
  });

  it("rejects a concurrent run with 409 CONFLICT while one is already in progress", async () => {
    let releaseFirstRun!: () => void;
    const firstRunGate = new Promise<void>((resolve) => {
      releaseFirstRun = resolve;
    });
    vi.mocked(extractFiles).mockImplementationOnce(async () => {
      await firstRunGate;
      return [ENTRY];
    });
    vi.mocked(downloadAll).mockResolvedValue({ succeeded: [DOWNLOADED], failed: [] });
    vi.mocked(buildArchive).mockResolvedValue(1);

    await withServer(makeConfig(path.join(workDir, "artifact.zip")), async (baseUrl) => {
      const firstRequest = fetch(`${baseUrl}/process`, { method: "POST" });
      await new Promise((resolve) => setTimeout(resolve, 20));

      const secondResponse = await fetch(`${baseUrl}/process`, { method: "POST" });
      expect(secondResponse.status).toBe(409);
      expect((await json(secondResponse)).error).toBe("CONFLICT");

      releaseFirstRun();
      expect((await firstRequest).status).toBe(200);
    });
  });

  it("GET /download returns 404 before any artifact exists, and 200 with correct headers once it does", async () => {
    const artifactPath = path.join(workDir, "artifact.zip");

    await withServer(makeConfig(artifactPath), async (baseUrl) => {
      const before = await fetch(`${baseUrl}/download`);
      expect(before.status).toBe(404);

      writeFileSync(artifactPath, "fake-zip-bytes");
      const after = await fetch(`${baseUrl}/download`);
      expect(after.status).toBe(200);
      expect(after.headers.get("content-type")).toBe("application/zip");
      expect(after.headers.get("content-disposition")).toContain("attachment");
      expect(await after.text()).toBe("fake-zip-bytes");
    });
  });

  it("sets X-Content-Type-Options: nosniff on every response", async () => {
    await withServer(makeConfig(path.join(workDir, "artifact.zip")), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/health`);
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    });
  });
});
