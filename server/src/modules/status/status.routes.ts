import { Router } from "express";
import { asyncHandler, chatRateLimit, validate } from "../../common";
import { statusController } from "./status.controller";
import { approvalSchema, sendMessageSchema, sessionParamsSchema } from "./status.schema";

const router = Router();

router.post("/messages", chatRateLimit, validate(sendMessageSchema), asyncHandler(statusController.sendMessage));
router.post(
  "/sessions/:sessionId/approval",
  chatRateLimit,
  validate(sessionParamsSchema, "params"),
  validate(approvalSchema),
  asyncHandler(statusController.respondToApproval),
);

export default router;
