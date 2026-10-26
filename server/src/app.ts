import cors from "cors";
import express from "express";
import { errorHandler, notFoundHandler, requestLogger } from "./common";
import apiRoutes from "./modules";

export function createApp() {
  const app = express();

  app.use(requestLogger);
  // Only our own web client may call this API from a browser. Without this, any website the
  // user visits could call http://127.0.0.1:3001 and read their machine's diagnostics.
  app.use(cors({ origin: (process.env.CLIENT_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173").split(",") }));
  app.use(express.json({ limit: "100kb" }));

  app.use("/api", apiRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
