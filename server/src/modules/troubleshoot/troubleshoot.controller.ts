import type { Request, Response } from "express";
import { ApiResponse } from "../../common";
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
}

export const troubleshootController = new TroubleshootController(troubleshootService);
