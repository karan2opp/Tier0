import { Router } from "express";
import { ApiResponse, asyncHandler } from "../common";
import { isDatabaseUp } from "../db/client";
import infoRoutes from "./info/info.routes";
import troubleshootRoutes from "./troubleshoot/troubleshoot.routes";

const router = Router();

router.get(
  "/health",
  asyncHandler(async (_req, res) => {
    const database = (await isDatabaseUp()) ? "up" : "down";
    ApiResponse.ok({ service: "tier0-server", database }, database === "up" ? "Healthy" : "Degraded").send(res);
  }),
);

router.use("/troubleshoot", troubleshootRoutes);
router.use("/info", infoRoutes);

export default router;
