import { Router } from "express";
import { asyncHandler, validate } from "../../common";
import { troubleshootController } from "./troubleshoot.controller";
import { approvalSchema, runToolSchema, sendMessageSchema, sessionParamsSchema } from "./troubleshoot.schema";

const router = Router();

router.get("/tools", asyncHandler(troubleshootController.listTools));
router.post("/messages", validate(sendMessageSchema), asyncHandler(troubleshootController.sendMessage));
router.post(
  "/sessions/:sessionId/approval",
  validate(sessionParamsSchema, "params"),
  validate(approvalSchema),
  asyncHandler(troubleshootController.respondToApproval),
);

// Runs a tool directly, skipping the agent and the approval step. Development only.
if (process.env.NODE_ENV !== "production") {
  router.post("/tools/:name/run", validate(runToolSchema), asyncHandler(troubleshootController.runTool));
}

export default router;
