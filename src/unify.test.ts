import { existsSync, mkdtempSync, openSync, readSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DownloadedFile } from "./download.js";
import type { FileEntry } from "./extract.js";
import { buildArchive } from "./unify.js";

function makeDownloaded(dir: string, fileName: string, content: string): DownloadedFile {
  const entry: FileEntry = {
    listingCode: "0001",
    displayName: "Arquivo teste",
    fileCode: fileName,
    url: `http://example.test/${fileName}`,
    fileName
  };
  const localPath = path.join(dir, fileName);
  writeFileSync(localPath, content);
  return { entry, localPath, bytes: Buffer.byteLength(content) };
}

function readMagicBytes(filePath: string, length: number): Buffer {
  const fd = openSync(filePath, "r");
  const buffer = Buffer.alloc(length);
  readSync(fd, buffer, 0, length, 0);
  return buffer;
}

describe("buildArchive", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), "archive-test-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("rejects with a 500 UNIFICATION_FAILED error when there are no files to archive", async () => {
    const artifactPath = path.join(workDir, "out.zip");
    await expect(buildArchive([], artifactPath)).rejects.toMatchObject({ statusCode: 500, code: "UNIFICATION_FAILED" });
    expect(existsSync(artifactPath)).toBe(false);
  });

  it("produces a valid zip whose size matches disk, creating missing parent directories", async () => {
    const files = [makeDownloaded(workDir, "a.pdf", "conteudo A"), makeDownloaded(workDir, "b.pdf", "conteudo B")];
    const artifactPath = path.join(workDir, "nested", "deep", "out.zip");

    const bytes = await buildArchive(files, artifactPath);

    expect(existsSync(artifactPath)).toBe(true);
    expect(bytes).toBe(statSync(artifactPath).size);
    // "PK\x03\x04" is the local file header signature that opens every zip archive.
    expect(readMagicBytes(artifactPath, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  });

  it("rejects when a referenced source file no longer exists on disk", async () => {
    const entry: FileEntry = {
      listingCode: "0001",
      displayName: "Arquivo fantasma",
      fileCode: "GHOST",
      url: "http://example.test/ghost.pdf",
      fileName: "ghost.pdf"
    };
    const missing: DownloadedFile = { entry, localPath: path.join(workDir, "does-not-exist.pdf"), bytes: 0 };

    await expect(buildArchive([missing], path.join(workDir, "out.zip"))).rejects.toMatchObject({ code: "UNIFICATION_FAILED" });
  });
});
