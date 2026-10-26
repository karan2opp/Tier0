import "./loadEnv";
import { createApp } from "./app";
import { logger } from "./common";
import { pool } from "./db/client";

const port = Number(process.env.PORT ?? 3001);
// Localhost only by default: this server can run diagnostics on this machine,
// so it must not be reachable from other devices on the network.
const host = process.env.HOST ?? "127.0.0.1";

const server = createApp().listen(port, host, () => {
  logger.info(`Tier0 server listening on http://${host}:${port}`);
});

// Close HTTP and database connections cleanly (also on tsx watch restarts).
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    logger.info({ signal }, "Shutting down");
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
  });
}
