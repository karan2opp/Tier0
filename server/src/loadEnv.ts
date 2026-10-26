import { fileURLToPath } from "node:url";
import { config } from "dotenv";

// Loads server/.env regardless of the working directory. Imported first in index.ts.
config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });
