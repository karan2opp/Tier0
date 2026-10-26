import "dotenv/config";
import { createApp } from "./app";

const port = Number(process.env.PORT ?? 3001);

createApp().listen(port, () => {
  console.log(`Tier0 server listening on http://localhost:${port}`);
});
