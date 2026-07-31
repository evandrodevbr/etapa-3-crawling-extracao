import { loadConfig } from "./env.js";
import { createServer } from "./server.js";

const config = loadConfig();
const server = createServer(config);

// "0.0.0.0" (padrão do HOST) é um endereço de bind, não algo que dá pra acessar num navegador —
// aqui trocamos só o texto do log para o endereço que de fato funciona em localhost.
const displayHost = config.host === "0.0.0.0" ? "localhost" : config.host;

server.listen(config.port, config.host, () => {
  console.log(`Server listening on http://${displayHost}:${config.port}`);
});

function shutdown(signal: string): void {
  console.log(`Received ${signal}, shutting down`);
  server.close(() => process.exit(0));
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
