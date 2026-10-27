import express, { Router } from "express";
import { asyncHandler, chatRateLimit, validate, voiceRateLimit } from "../../common";
import { MAX_AUDIO_BYTES } from "../voice/voice.service";
import { conversationController } from "./conversations.controller";
import { approvalSchema, conversationParamsSchema, sendMessageSchema, speechParamsSchema } from "./conversations.schema";

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
router.get(
  "/:sessionId/speech/:index",
  voiceRateLimit,
  validate(speechParamsSchema, "params"),
  asyncHandler(conversationController.speech),
);
router.post(
  "/:sessionId/transcribe",
  voiceRateLimit,
  validate(conversationParamsSchema, "params"),
  express.raw({ type: ["audio/wav", "audio/x-wav", "audio/webm"], limit: MAX_AUDIO_BYTES }),
  asyncHandler(conversationController.transcribe),
);

export default router;
