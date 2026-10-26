import type { Request, Response } from "express";
import { ApiResponse } from "../../common";
import type { SendMessageInput } from "./status.schema";
import { statusService, type StatusService } from "./status.service";

export class StatusController {
  constructor(private readonly service: StatusService) {}

  sendMessage = async (req: Request, res: Response) => {
    const reply = await this.service.handleMessage(req.body as SendMessageInput);
    ApiResponse.ok(reply, "Message processed").send(res);
  };

  respondToApproval = async (req: Request, res: Response) => {
    const reply = await this.service.handleApproval(req.params.sessionId, req.body.approve as boolean);
    ApiResponse.ok(reply, "Approval processed").send(res);
  };
}

export const statusController = new StatusController(statusService);
