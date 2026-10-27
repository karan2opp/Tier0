import type { Request, Response } from "express";
import { ApiResponse } from "../../common";
import type { AgentName } from "../conversations/conversations.schema";
import { FILLERS, type FillerKind } from "./voice.fillers";
import { voiceService, type VoiceService } from "./voice.service";

/**
 * Sends an agent line as MP3: from the cache, or generated (complete, with a stall retry) and cached, so the same
 * line is never paid for twice.
 */
export async function sendSpeech(
  res: Response,
  voice: VoiceService,
  { text, agent, cached, remember }: { text: string; agent: AgentName; cached?: Buffer; remember: (audio: Buffer) => void },
) {
  // Generated before any header is sent, so a failure still returns a normal JSON error.
  const audio = cached ?? (await voice.synthesize(text, agent));
  if (!cached) remember(audio);
  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.end(audio);
}

export class VoiceController {
  constructor(private readonly voice: VoiceService) {}

  /** The filler phrases, so the client can show them as captions and use them with the browser voice. */
  fillers = async (_req: Request, res: Response) => {
    ApiResponse.ok(FILLERS, "Filler phrases").send(res);
  };

  /** One filler phrase in an agent's voice. Only phrases from the fixed list can be spoken. */
  filler = async (req: Request, res: Response) => {
    const { agent, kind, index } = req.params as unknown as { agent: AgentName; kind: FillerKind; index: number };
    const text = FILLERS[kind][index % FILLERS[kind].length];
    const key = `${agent}:${kind}:${index}`;
    await sendSpeech(res, this.voice, {
      text,
      agent,
      cached: this.voice.fillerCached(key),
      remember: (audio) => this.voice.rememberFiller(key, audio),
    });
  };
}

export const voiceController = new VoiceController(voiceService);
