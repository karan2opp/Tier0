import { pino } from "pino";

const isProduction = process.env.NODE_ENV === "production";

/**
 * App-wide structured logger. JSON in production; readable, colored lines in development.
 * Never log request bodies or tool output wholesale: they can contain personal data.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "tier0-server" },
  redact: ["req.headers.authorization", "req.headers.cookie"],
  ...(!isProduction && {
    transport: {
      target: "pino-pretty",
      options: { colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname,service" },
    },
  }),
});
