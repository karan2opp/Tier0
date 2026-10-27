import { Router } from "express";
import { asyncHandler, chatRateLimit, validate } from "../../common";
import { conversationController } from "./conversations.controller";
import { approvalSchema, conversationParamsSchema, sendMessageSchema } from "./conversations.schema";

const router = Router();

router.post("/", chatRateLimit, asyncHandler(conversationController.start));
router.get("/:sessionId", validate(conversationParamsSchema, "params"), asyncHandler(conversationController.get));
router.post(
  "/:sessionId/messages",
  chatRateLimit,
  validate(conversationParamsSchema, "params"),
  validate(sendMessageSchema),
  asyncHandler(conversationController.sendMessage),
);
router.post(
  "/:sessionId/approval",
  chatRateLimit,
  validate(conversationParamsSchema, "params"),
  validate(approvalSchema),
  asyncHandler(conversationController.answerApproval),
);

export default router;
