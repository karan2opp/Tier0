import { Router } from "express";
import { asyncHandler, validate } from "../../common";
import { troubleshootController } from "./troubleshoot.controller";
import { runToolSchema } from "./troubleshoot.schema";

const router = Router();

router.get("/tools", asyncHandler(troubleshootController.listTools));

// Runs a tool directly, skipping the agent and the approval step. Development only.
if (process.env.NODE_ENV !== "production") {
  router.post("/tools/:name/run", validate(runToolSchema), asyncHandler(troubleshootController.runTool));
}

export default router;
