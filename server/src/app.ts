import cors from "cors";
import express from "express";
import { errorHandler, notFoundHandler } from "./common";
import apiRoutes from "./modules";

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.use("/api", apiRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
