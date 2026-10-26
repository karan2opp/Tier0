/** Matches docker-compose.yml. Used only when DATABASE_URL is not set, and never in production. */
const LOCAL_DEV_URL = "postgres://tier0:tier0_local_dev@127.0.0.1:5434/tier0";

export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url) return url;
  if (process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL must be set in production");
  }
  return LOCAL_DEV_URL;
}
