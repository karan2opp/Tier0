import { Router } from "express";
import { asyncHandler, chatRateLimit, validate } from "../../common";
import { infoController } from "./info.controller";
import { sendMessageSchema } from "./info.schema";

const router = Router();

router.post("/messages", chatRateLimit, validate(sendMessageSchema), asyncHandler(infoController.sendMessage));

export default router;
