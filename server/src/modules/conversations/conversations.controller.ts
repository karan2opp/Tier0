import type { Request, Response } from "express";
import { ApiResponse } from "../../common";
import type { SendMessageInput } from "./conversations.schema";
import { conversationService, type ConversationService } from "./conversations.service";

export class ConversationController {
  constructor(private readonly service: ConversationService) {}

  start = async (_req: Request, res: Response) => {
    ApiResponse.created(this.service.start(), "Conversation started").send(res);
  };

  get = async (req: Request, res: Response) => {
    ApiResponse.ok(this.service.get(req.params.sessionId), "Conversation").send(res);
  };

  sendMessage = async (req: Request, res: Response) => {
    const { message } = req.body as SendMessageInput;
    const reply = await this.service.sendMessage(req.params.sessionId, message);
    ApiResponse.ok(reply, "Message processed").send(res);
  };

  answerApproval = async (req: Request, res: Response) => {
    const reply = await this.service.answerApproval(req.params.sessionId, req.body.approve as boolean);
    ApiResponse.ok(reply, "Answer processed").send(res);
  };
}

export const conversationController = new ConversationController(conversationService);
