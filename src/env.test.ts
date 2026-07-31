import { describe, expect, it } from "vitest";
import { loadConfig } from "./env.js";

describe("loadConfig", () => {
  it("applies sensible defaults when no environment variables are set", () => {
    const config = loadConfig({});

    expect(config.targetUrl).toBe("http://omnissolucoes.com/teste3/");
    expect(config.targetOrigin).toBe("http://omnissolucoes.com");
    expect(config.host).toBe("0.0.0.0");
    expect(config.port).toBe(3000);
    expect(config.downloadsDir).toBe("./data/downloads");
    expect(config.artifactPath).toBe("./data/artifact.zip");
    expect(config.pageFetchTimeoutMs).toBe(10_000);
    expect(config.fileDownloadTimeoutMs).toBe(20_000);
    expect(config.downloadConcurrency).toBe(4);
  });

  it("honors every overridden environment variable", () => {
    const config = loadConfig({
      TARGET_URL: "https://files.example.com/list/",
      HOST: "127.0.0.1",
      PORT: "8080",
      DATA_DIR: "/var/data",
      PAGE_FETCH_TIMEOUT_MS: "5000",
      FILE_DOWNLOAD_TIMEOUT_MS: "15000",
      DOWNLOAD_CONCURRENCY: "8"
    });

    expect(config.targetUrl).toBe("https://files.example.com/list/");
    expect(config.targetOrigin).toBe("https://files.example.com");
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(8080);
    expect(config.downloadsDir).toBe("/var/data/downloads");
    expect(config.artifactPath).toBe("/var/data/artifact.zip");
    expect(config.pageFetchTimeoutMs).toBe(5000);
    expect(config.fileDownloadTimeoutMs).toBe(15_000);
    expect(config.downloadConcurrency).toBe(8);
  });

  it("treats an empty string env var as absent and falls back to the default", () => {
    expect(loadConfig({ PORT: "" }).port).toBe(3000);
  });

  it.each(["not-a-number", "3.5", "0", "-1"])("rejects PORT=%s when not a positive integer", (value) => {
    expect(() => loadConfig({ PORT: value })).toThrow(/PORT/);
  });

  it("rejects a PORT above the valid TCP range", () => {
    expect(() => loadConfig({ PORT: "70000" })).toThrow(/<= 65535/);
  });

  it("rejects an unparseable TARGET_URL and one using a disallowed protocol", () => {
    expect(() => loadConfig({ TARGET_URL: "not a url" })).toThrow(/TARGET_URL/);
    expect(() => loadConfig({ TARGET_URL: "ftp://example.com/files/" })).toThrow(/only http\/https/);
  });

  it.each(["PAGE_FETCH_TIMEOUT_MS", "FILE_DOWNLOAD_TIMEOUT_MS", "DOWNLOAD_CONCURRENCY"])(
    "rejects a non-positive-integer value for %s",
    (key) => {
      expect(() => loadConfig({ [key]: "-5" })).toThrow(new RegExp(key));
      expect(() => loadConfig({ [key]: "abc" })).toThrow(new RegExp(key));
    }
  );
});
