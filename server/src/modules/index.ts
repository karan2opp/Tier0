import { Router } from "express";
import { ApiResponse } from "../common";
import troubleshootRoutes from "./troubleshoot/troubleshoot.routes";

const router = Router();

router.get("/health", (_req, res) => {
  ApiResponse.ok({ service: "tier0-server" }, "Healthy").send(res);
});

router.use("/troubleshoot", troubleshootRoutes);

export default router;
