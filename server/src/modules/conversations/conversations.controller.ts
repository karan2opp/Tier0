import type { Request, Response } from "express";
import { ApiResponse, BadRequestError } from "../../common";
import { sendSpeech } from "../voice/voice.controller";
import { voiceService, type VoiceService } from "../voice/voice.service";
import type { SendMessageInput } from "./conversations.schema";
import { conversationService, type ConversationService } from "./conversations.service";

export class ConversationController {
  constructor(
    private readonly service: ConversationService,
    private readonly voice: VoiceService,
  ) {}

  start = async (_req: Request, res: Response) => {
    ApiResponse.created(this.service.start(), "Conversation started").send(res);
  };

  get = async (req: Request, res: Response) => {
    ApiResponse.ok(this.service.get(req.params.sessionId), "Conversation").send(res);
  };

  sendMessage = async (req: Request, res: Response) => {
    const { message, interrupted } = req.body as SendMessageInput;
    const reply = await this.service.sendMessage(req.params.sessionId, message, interrupted);
    ApiResponse.ok(reply, "Message processed").send(res);
  };

  answerApproval = async (req: Request, res: Response) => {
    const reply = await this.service.answerApproval(req.params.sessionId, req.body.approve as boolean);
    ApiResponse.ok(reply, "Answer processed").send(res);
  };

  /** Speaks one of the agents' own lines from this conversation (never arbitrary text), streaming MP3. */
  speech = async (req: Request, res: Response) => {
    const { sessionId, index } = req.params as unknown as { sessionId: string; index: number };
    const { agent, text } = this.service.agentLine(sessionId, index);
    const key = `${sessionId}:${index}`;
    await sendSpeech(res, this.voice, {
      text,
      agent,
      cached: this.voice.cached(key),
      remember: (audio) => this.voice.remember(key, audio),
    });
  };

  /** Turns the customer's recorded speech into text. The client then sends it as a normal message. */
  transcribe = async (req: Request, res: Response) => {
    // The conversation must exist before we pay for a transcription.
    this.service.get(req.params.sessionId);
    if (!Buffer.isBuffer(req.body)) throw new BadRequestError("Send the recording as audio/wav");
    const text = await this.voice.transcribe(req.body, req.get("content-type") ?? "audio/wav");
    ApiResponse.ok({ text }, "Transcribed").send(res);
  };
}

export const conversationController = new ConversationController(conversationService, voiceService);
