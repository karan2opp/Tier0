import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { logger } from "../common/logger";
import * as schema from "./schema";
import { getDatabaseUrl } from "./url";

export const pool = new Pool({ connectionString: getDatabaseUrl(), max: 10 });

pool.on("error", (err) => logger.error({ err }, "Unexpected Postgres pool error"));

export const db = drizzle(pool, { schema });

/** Lightweight connectivity check for the health endpoint. */
export async function isDatabaseUp(): Promise<boolean> {
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  }
}
