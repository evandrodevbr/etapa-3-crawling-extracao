import { createReadStream, existsSync } from "node:fs";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AppConfig } from "./env.js";
import { AppError } from "./errors.js";
import { extractFiles } from "./extract.js";
import { downloadAll } from "./download.js";
import { buildArchive } from "./unify.js";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff" });
  res.end(JSON.stringify(body));
}

/**
 * Builds the HTTP server (not yet listening) so tests can spin up an isolated instance on an
 * ephemeral port. All wiring — routing, the pipeline orchestration, and error mapping — lives
 * here rather than behind separate service interfaces, since each stage has exactly one real
 * implementation and there is nothing to swap.
 */
export function createServer(config: AppConfig): Server {
  let running = false;

  async function runPipeline() {
    if (running) {
      throw new AppError("A pipeline run is already in progress", 409, "CONFLICT");
    }
    running = true;
    const startedAt = Date.now();
    try {
      const entries = await extractFiles(config.targetUrl, config.targetOrigin, config.pageFetchTimeoutMs);
      const { succeeded, failed } = await downloadAll(entries, config.downloadsDir, config.downloadConcurrency, config.fileDownloadTimeoutMs);
      const artifactBytes = await buildArchive(succeeded, config.artifactPath);

      return {
        filesFound: entries.length,
        filesDownloaded: succeeded.length,
        filesFailed: failed.length,
        // nome, URL e código de cada arquivo identificado na página alvo (o que a extração
        // encontrou de fato), não só a contagem — evidencia que a extração funcionou.
        files: succeeded.map((f) => ({ name: f.entry.displayName, code: f.entry.fileCode, url: f.entry.url })),
        failures: failed.map((f) => ({ fileCode: f.entry.fileCode, url: f.entry.url, reason: f.reason })),
        artifactPath: config.artifactPath,
        artifactBytes,
        durationMs: Date.now() - startedAt
      };
    } finally {
      running = false;
    }
  }

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");

    try {
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(302, { location: "/health" });
        res.end();
        return;
      }

      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, { status: "ok" });
        return;
      }

      if (req.method === "POST" && url.pathname === "/process") {
        sendJson(res, 200, await runPipeline());
        return;
      }

      if (req.method === "GET" && url.pathname === "/download") {
        if (!existsSync(config.artifactPath)) {
          throw new AppError("No unified artifact has been generated yet. Call POST /process first.", 404, "NOT_FOUND");
        }
        res.writeHead(200, {
          "content-type": "application/zip",
          "content-disposition": 'attachment; filename="artefato-unificado.zip"',
          "x-content-type-options": "nosniff"
        });
        createReadStream(config.artifactPath).pipe(res);
        return;
      }

      sendJson(res, 404, { error: "NOT_FOUND", message: "Route not found" });
    } catch (error) {
      if (error instanceof AppError) {
        console.warn(`[${error.code}] ${req.method} ${url.pathname}: ${error.message}`);
        sendJson(res, error.statusCode, { error: error.code, message: error.message });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[INTERNAL_ERROR] ${req.method} ${url.pathname}: ${message}`);
      sendJson(res, 500, { error: "INTERNAL_ERROR", message: "An unexpected error occurred." });
    }
  }

  return createHttpServer((req, res) => void handleRequest(req, res));
}
