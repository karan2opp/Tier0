import { Router } from "express";
import { ApiResponse } from "../common";

const router = Router();

router.get("/health", (_req, res) => {
  ApiResponse.ok({ service: "tier0-server" }, "Healthy").send(res);
});

// Domain modules (e.g. chat/) get mounted here: router.use("/chat", chatRoutes);

export default router;
