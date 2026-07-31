import * as cheerio from "cheerio";
import path from "node:path";
import { AppError } from "./errors.js";
import { isAllowedFileUrl, sanitizeFileName, tryResolveUrl } from "./security.js";

export interface FileEntry {
  readonly listingCode: string;
  readonly displayName: string;
  readonly fileCode: string;
  readonly url: string;
  readonly fileName: string;
}

const LEADING_LABEL = /^(\S+)\s*-\s*(.+)$/;

/** Fetches a page's HTML with a hard timeout, translating every failure mode into an AppError. */
export async function fetchHtml(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "follow" });
    if (!response.ok) {
      throw new AppError(`Target page responded with status ${response.status}`, 502, "EXTRACTION_FAILED");
    }
    return await response.text();
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new AppError(`Timed out fetching target page after ${timeoutMs}ms`, 502, "EXTRACTION_FAILED");
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new AppError(`Failed to fetch target page: ${message}`, 502, "EXTRACTION_FAILED");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parses the target page's `<ul><li>` listing. Each `<li>` is expected to contain a leading
 * "CODE - name" text node followed by an `<a href codigo="...">`. Items missing an href/codigo,
 * or not matching the expected label shape, are skipped rather than thrown, so one malformed row
 * never takes down the whole extraction.
 */
export function parseListingHtml(html: string): Array<{ listingCode: string; displayName: string; fileCode: string; href: string }> {
  const $ = cheerio.load(html);
  const items: Array<{ listingCode: string; displayName: string; fileCode: string; href: string }> = [];

  $("li").each((_index, element) => {
    const li = $(element);
    const link = li.find("a[href]").first();
    const href = link.attr("href");
    const fileCode = link.attr("codigo");
    if (!href || !fileCode) return;

    const labelText = li.clone().children().remove().end().text().trim().replace(/\s+/g, " ");
    const match = LEADING_LABEL.exec(labelText);
    if (!match) return;

    const [, listingCode, displayName] = match;
    if (!listingCode || !displayName) return;

    items.push({ listingCode, displayName, fileCode, href });
  });

  return items;
}

/**
 * Fetches the target page, parses its file listing, and validates every link against the
 * same-origin SSRF guard before it is allowed downstream. Invalid entries are dropped with a
 * console warning instead of aborting the whole run.
 */
export async function extractFiles(targetUrl: string, targetOrigin: string, timeoutMs: number): Promise<FileEntry[]> {
  const html = await fetchHtml(targetUrl, timeoutMs);
  const rawItems = parseListingHtml(html);

  const entries: FileEntry[] = [];
  for (const item of rawItems) {
    const resolved = tryResolveUrl(item.href, targetUrl);
    if (!resolved || !isAllowedFileUrl(resolved, targetOrigin)) {
      console.warn(`Discarding file entry with disallowed or unresolvable URL: ${item.fileCode} -> ${item.href}`);
      continue;
    }

    const fileName = sanitizeFileName(path.basename(resolved.pathname), `${item.fileCode}.bin`);
    entries.push({
      listingCode: item.listingCode,
      displayName: item.displayName,
      fileCode: item.fileCode,
      url: resolved.toString(),
      fileName
    });
  }

  if (entries.length === 0) {
    throw new AppError("No valid file entries found on target page", 502, "EXTRACTION_FAILED");
  }

  return entries;
}
