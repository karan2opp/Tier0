import type { Request, Response } from "express";
import { ApiResponse } from "../../common";
import type { SendMessageInput } from "./troubleshoot.schema";
import { troubleshootService, type TroubleshootService } from "./troubleshoot.service";

export class TroubleshootController {
  constructor(private readonly service: TroubleshootService) {}

  listTools = async (_req: Request, res: Response) => {
    ApiResponse.ok(this.service.listTools(), "Available diagnostic tools").send(res);
  };

  runTool = async (req: Request, res: Response) => {
    const output = await this.service.runTool(req.params.name, req.body);
    ApiResponse.ok(output, "Tool executed").send(res);
  };

  sendMessage = async (req: Request, res: Response) => {
    const reply = await this.service.handleMessage(req.body as SendMessageInput);
    ApiResponse.ok(reply, "Message processed").send(res);
  };

  respondToApproval = async (req: Request, res: Response) => {
    const reply = await this.service.handleApproval(req.params.sessionId, req.body.approve as boolean);
    ApiResponse.ok(reply, "Approval processed").send(res);
  };
}

export const troubleshootController = new TroubleshootController(troubleshootService);
