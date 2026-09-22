import app from "./app";
import { logger } from "./lib/logger";
import { startTelegramBot } from "./lib/telegram-bot";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, () => {
  logger.info({ port }, "Server listening");
});

const stopTelegramBot = startTelegramBot();
const shutdown = (signal: string) => {
  logger.info({ signal }, "Server shutdown requested");
  stopTelegramBot();
  server.close(() => process.exit(0));
};

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
