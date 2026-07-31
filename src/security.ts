import path from "node:path";

const SAFE_FILENAME_CHARS = /[^A-Za-z0-9._-]/g;
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Reduces an untrusted string (scraped from HTML) to a filename safe to join onto a local
 * directory: strips any directory component and disallowed characters, preventing path
 * traversal (`../../etc/passwd`) and separator injection.
 */
export function sanitizeFileName(rawName: string, fallback: string): string {
  const cleaned = path
    .basename(rawName.trim())
    .replace(SAFE_FILENAME_CHARS, "_")
    .replace(/^\.+/, "");
  return cleaned.length > 0 ? cleaned : fallback;
}

/**
 * Confirms a joined path still lives inside `directory`, defeating traversal attempts that
 * survive filename sanitization.
 */
export function resolveSafeJoin(directory: string, fileName: string): string {
  const resolvedDir = path.resolve(directory);
  const resolvedPath = path.resolve(resolvedDir, fileName);
  if (resolvedPath !== resolvedDir && !resolvedPath.startsWith(resolvedDir + path.sep)) {
    throw new Error(`Unsafe path escapes target directory: ${fileName}`);
  }
  return resolvedPath;
}

/**
 * Anti-SSRF guard: a link scraped from the target page must resolve to an http(s) URL on the
 * same origin as the configured target, otherwise a malicious/compromised page could make the
 * server fetch arbitrary internal or third-party URLs on its behalf.
 */
export function isAllowedFileUrl(candidate: URL, allowedOrigin: string): boolean {
  return ALLOWED_PROTOCOLS.has(candidate.protocol) && candidate.origin === allowedOrigin;
}

/** Resolves a possibly-relative href against the page URL, or null when it isn't parseable. */
export function tryResolveUrl(href: string, base: string): URL | null {
  try {
    return new URL(href, base);
  } catch {
    return null;
  }
}
