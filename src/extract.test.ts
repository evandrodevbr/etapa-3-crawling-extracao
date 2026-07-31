import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractFiles, fetchHtml, parseListingHtml } from "./extract.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureHtml = readFileSync(path.resolve(__dirname, "../test/fixtures/target-page.html"), "utf-8");

describe("parseListingHtml", () => {
  it("extracts every well-formed listing item from the real target page fixture", () => {
    const items = parseListingHtml(fixtureHtml);

    expect(items).toHaveLength(6);
    expect(items[0]).toEqual({ listingCode: "0003", displayName: "Arquivo documento145", fileCode: "FT1", href: "FT1.pdf" });
    expect(items.map((item) => item.fileCode)).toEqual(["FT1", "FH1", "AXL", "ZTT", "FTR", "AAA"]);
  });

  it("returns an empty array for pages with no <li>, or an empty string", () => {
    expect(parseListingHtml("<html><body><p>nada</p></body></html>")).toEqual([]);
    expect(parseListingHtml("")).toEqual([]);
  });

  it("skips items missing href, missing codigo, missing the anchor entirely, or not matching 'CODE - name'", () => {
    expect(parseListingHtml(`<ul><li>0001 - Doc <a codigo="ABC">x</a></li></ul>`)).toEqual([]);
    expect(parseListingHtml(`<ul><li>0001 - Doc <a href="a.pdf">x</a></li></ul>`)).toEqual([]);
    expect(parseListingHtml(`<ul><li>0001 - Doc sem link</li></ul>`)).toEqual([]);
    expect(parseListingHtml(`<ul><li>sem separador <a href="a.pdf" codigo="ABC">x</a></li></ul>`)).toEqual([]);
  });

  it("keeps valid items and drops only the malformed ones in a mixed listing, collapsing whitespace in the name", () => {
    const html = `
      <ul>
        <li>0001 -    Valido   com  espacos \n <a href="a.pdf" codigo="AAA">x</a></li>
        <li>invalido sem separador <a href="b.pdf" codigo="BBB">x</a></li>
      </ul>`;
    const items = parseListingHtml(html);
    expect(items).toEqual([{ listingCode: "0001", displayName: "Valido com espacos", fileCode: "AAA", href: "a.pdf" }]);
  });
});

describe("fetchHtml", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the response body as text on a 2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>ok</html>", { status: 200 })));
    expect(await fetchHtml("http://example.test/page", 1000)).toBe("<html>ok</html>");
  });

  it("throws for a non-2xx response and for a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    await expect(fetchHtml("http://example.test/page", 1000)).rejects.toMatchObject({ statusCode: 502 });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("getaddrinfo ENOTFOUND example.test");
      })
    );
    await expect(fetchHtml("http://example.test/page", 1000)).rejects.toMatchObject({ statusCode: 502 });
  });

  it("aborts and throws when the request exceeds the timeout", async () => {
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
    await expect(fetchHtml("http://example.test/page", 10)).rejects.toThrow(/Timed out/);
  });
});

const TARGET_URL = "http://example.test/teste3/";
const TARGET_ORIGIN = "http://example.test";

describe("extractFiles", () => {
  afterEach(() => vi.unstubAllGlobals());

  function mockPage(html: string) {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(html, { status: 200 })));
  }

  it("returns validated, sanitized file entries for a well-formed listing", async () => {
    mockPage(`<ul>
      <li>0003 - Arquivo documento145 <a href="FT1.pdf" codigo="FT1">x</a></li>
      <li>00004 - Arquivo documento146 <a href="FH1.pdf" codigo="FH1">x</a></li>
    </ul>`);

    const entries = await extractFiles(TARGET_URL, TARGET_ORIGIN, 1000);

    expect(entries).toEqual([
      { listingCode: "0003", displayName: "Arquivo documento145", fileCode: "FT1", url: `${TARGET_URL}FT1.pdf`, fileName: "FT1.pdf" },
      { listingCode: "00004", displayName: "Arquivo documento146", fileCode: "FH1", url: `${TARGET_URL}FH1.pdf`, fileName: "FH1.pdf" }
    ]);
  });

  it("drops entries pointing to a different origin (SSRF) or a disallowed protocol, keeping valid ones", async () => {
    mockPage(`<ul>
      <li>0001 - Legitimo <a href="a.pdf" codigo="AAA">x</a></li>
      <li>0002 - Malicioso <a href="http://evil.test/steal.pdf" codigo="BBB">x</a></li>
      <li>0003 - Local file <a href="file:///etc/passwd" codigo="CCC">x</a></li>
    </ul>`);

    const entries = await extractFiles(TARGET_URL, TARGET_ORIGIN, 1000);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.fileCode).toBe("AAA");
  });

  it("neutralizes path traversal in the href by keeping only the resolved basename", async () => {
    mockPage(`<ul><li>0001 - Traversal <a href="../../../../etc/passwd" codigo="EVL">x</a></li></ul>`);

    const entries = await extractFiles(TARGET_URL, TARGET_ORIGIN, 1000);

    expect(entries[0]?.fileName).toBe("passwd");
    expect(entries[0]?.fileName).not.toMatch(/[/\\]/);
  });

  it("throws when the listing has no valid entries", async () => {
    mockPage("<ul></ul>");
    await expect(extractFiles(TARGET_URL, TARGET_ORIGIN, 1000)).rejects.toMatchObject({ code: "EXTRACTION_FAILED" });
  });
});
