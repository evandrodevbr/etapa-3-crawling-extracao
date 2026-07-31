import path from "node:path";
import { describe, expect, it } from "vitest";
import { isAllowedFileUrl, resolveSafeJoin, sanitizeFileName, tryResolveUrl } from "./security.js";

describe("sanitizeFileName", () => {
  it("keeps an already-safe filename untouched", () => {
    expect(sanitizeFileName("FT1.pdf", "fallback.bin")).toBe("FT1.pdf");
  });

  it("strips Unix and Windows directory components, keeping only the basename", () => {
    expect(sanitizeFileName("../../etc/passwd", "fallback.bin")).toBe("passwd");
    expect(sanitizeFileName("C:\\Windows\\System32\\evil.dll", "fallback.bin")).toBe("evil.dll");
  });

  it("replaces disallowed characters and strips leading dots", () => {
    expect(sanitizeFileName("weird name?.pdf", "fallback.bin")).toBe("weird_name_.pdf");
    expect(sanitizeFileName(".hidden", "fallback.bin")).toBe("hidden");
  });

  it("falls back to the provided default when nothing safe remains", () => {
    expect(sanitizeFileName("///", "fallback.bin")).toBe("fallback.bin");
    expect(sanitizeFileName("..", "fallback.bin")).toBe("fallback.bin");
    expect(sanitizeFileName("", "fallback.bin")).toBe("fallback.bin");
  });
});

describe("resolveSafeJoin", () => {
  const baseDir = path.resolve("/tmp/downloads");

  it("joins a plain filename inside the directory", () => {
    expect(resolveSafeJoin(baseDir, "a.pdf")).toBe(path.join(baseDir, "a.pdf"));
  });

  it("throws when the filename attempts to escape the directory, relatively or absolutely", () => {
    expect(() => resolveSafeJoin(baseDir, "../../etc/passwd")).toThrow(/escapes target directory/);
    expect(() => resolveSafeJoin(baseDir, "/etc/passwd")).toThrow(/escapes target directory/);
  });
});

describe("isAllowedFileUrl", () => {
  const origin = "http://example.test";

  it("allows an http(s) URL matching the configured origin", () => {
    expect(isAllowedFileUrl(new URL("http://example.test/file.pdf"), origin)).toBe(true);
  });

  it("rejects a different host, a different port, and disallowed protocols", () => {
    expect(isAllowedFileUrl(new URL("http://evil.test/file.pdf"), origin)).toBe(false);
    expect(isAllowedFileUrl(new URL("http://example.test:8443/file.pdf"), origin)).toBe(false);
    expect(isAllowedFileUrl(new URL("file:///etc/passwd"), "null")).toBe(false);
    expect(isAllowedFileUrl(new URL("javascript:alert(1)"), "null")).toBe(false);
  });
});

describe("tryResolveUrl", () => {
  it("resolves a relative href against the base page URL", () => {
    expect(tryResolveUrl("file.pdf", "http://example.test/teste3/")?.toString()).toBe("http://example.test/teste3/file.pdf");
  });

  it("returns null for an unparseable href", () => {
    expect(tryResolveUrl("http://[invalid-ipv6", "http://example.test/teste3/")).toBeNull();
  });
});
