import { Router } from "express";
import { z } from "zod";
import { asyncHandler, validate, voiceRateLimit } from "../../common";
import { agentNames } from "../conversations/conversations.schema";
import { voiceController } from "./voice.controller";
import { fillerKinds } from "./voice.fillers";

const fillerParamsSchema = z.object({
  agent: z.enum(agentNames),
  kind: z.enum(fillerKinds as [string, ...string[]]),
  index: z.coerce.number().int().min(0).max(20),
});

const router = Router();

router.get("/fillers", asyncHandler(voiceController.fillers));
router.get(
  "/fillers/:agent/:kind/:index",
  voiceRateLimit,
  validate(fillerParamsSchema, "params"),
  asyncHandler(voiceController.filler),
);

export default router;
