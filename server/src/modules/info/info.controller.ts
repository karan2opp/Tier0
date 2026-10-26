import type { Request, Response } from "express";
import { ApiResponse } from "../../common";
import type { SendMessageInput } from "./info.schema";
import { infoService, type InfoService } from "./info.service";

export class InfoController {
  constructor(private readonly service: InfoService) {}

  sendMessage = async (req: Request, res: Response) => {
    const reply = await this.service.handleMessage(req.body as SendMessageInput);
    ApiResponse.ok(reply, "Message processed").send(res);
  };
}

export const infoController = new InfoController(infoService);
