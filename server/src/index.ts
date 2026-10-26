import "./loadEnv";
import { createApp } from "./app";
import { logger } from "./common";

const port = Number(process.env.PORT ?? 3001);
// Localhost only by default: this server can run diagnostics on this machine,
// so it must not be reachable from other devices on the network.
const host = process.env.HOST ?? "127.0.0.1";

createApp().listen(port, host, () => {
  logger.info(`Tier0 server listening on http://${host}:${port}`);
});
