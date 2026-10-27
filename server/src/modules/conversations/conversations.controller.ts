import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { Request, Response } from "express";
import { ApiResponse, BadRequestError, logger } from "../../common";
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
    const sendAudioHeaders = () => {
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "private, max-age=3600");
    };

    const cached = this.voice.cached(key);
    if (cached) {
      sendAudioHeaders();
      res.end(cached);
      return;
    }

    // Stream to the browser as it is generated (playback starts sooner), keeping a copy for replays.
    const upstream = await this.voice.synthesize(text, agent);
    sendAudioHeaders();
    const chunks: Buffer[] = [];
    const audio = Readable.fromWeb(upstream.body as WebReadableStream<Uint8Array>);
    audio.on("data", (chunk: Buffer) => chunks.push(chunk));
    audio.on("end", () => this.voice.remember(key, Buffer.concat(chunks)));
    audio.on("error", (err) => {
      logger.error({ err }, "Speech stream failed");
      res.destroy(err);
    });
    // A customer who interrupts closes the request; stop downloading audio nobody will hear.
    res.on("close", () => audio.destroy());
    audio.pipe(res);
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
