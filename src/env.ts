export interface AppConfig {
  readonly host: string;
  readonly port: number;
  readonly targetUrl: string;
  readonly targetOrigin: string;
  readonly downloadsDir: string;
  readonly artifactPath: string;
  readonly pageFetchTimeoutMs: number;
  readonly fileDownloadTimeoutMs: number;
  readonly downloadConcurrency: number;
}

function readPositiveInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid environment variable ${key}="${raw}": expected a positive integer.`);
  }
  return value;
}

function readUrl(env: NodeJS.ProcessEnv, key: string, fallback: string): URL {
  const raw = env[key] ?? fallback;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Invalid environment variable ${key}="${raw}": expected an absolute URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Invalid environment variable ${key}="${raw}": only http/https are supported.`);
  }
  return parsed;
}

/** Reads and validates all runtime configuration once, failing fast on startup rather than mid-request. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const targetUrl = readUrl(env, "TARGET_URL", "http://omnissolucoes.com/teste3/");
  const port = readPositiveInt(env, "PORT", 3000);
  if (port > 65535) {
    throw new Error(`Invalid environment variable PORT="${port}": must be <= 65535.`);
  }
  const dataDir = env.DATA_DIR?.trim() || "./data";

  return {
    host: env.HOST?.trim() || "0.0.0.0",
    port,
    targetUrl: targetUrl.toString(),
    targetOrigin: targetUrl.origin,
    downloadsDir: `${dataDir}/downloads`,
    artifactPath: `${dataDir}/artifact.zip`,
    pageFetchTimeoutMs: readPositiveInt(env, "PAGE_FETCH_TIMEOUT_MS", 10_000),
    fileDownloadTimeoutMs: readPositiveInt(env, "FILE_DOWNLOAD_TIMEOUT_MS", 20_000),
    downloadConcurrency: readPositiveInt(env, "DOWNLOAD_CONCURRENCY", 4)
  };
}
