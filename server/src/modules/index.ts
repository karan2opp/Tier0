import { Router } from "express";
import { ApiResponse, asyncHandler } from "../common";
import { isDatabaseUp } from "../db/client";
import conversationRoutes from "./conversations/conversations.routes";
import troubleshootRoutes from "./troubleshoot/troubleshoot.routes";
import { voiceService } from "./voice/voice.service";

const router = Router();

router.get(
  "/health",
  asyncHandler(async (_req, res) => {
    const database = (await isDatabaseUp()) ? "up" : "down";
    const voice = { openai: voiceService.available };
    ApiResponse.ok({ service: "tier0-server", database, voice }, database === "up" ? "Healthy" : "Degraded").send(res);
  }),
);

router.use("/conversations", conversationRoutes);
router.use("/troubleshoot", troubleshootRoutes);

export default router;
