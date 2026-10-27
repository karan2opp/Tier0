import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { Request, Response } from "express";
import { ApiResponse, logger } from "../../common";
import type { AgentName } from "../conversations/conversations.schema";
import { FILLERS, type FillerKind } from "./voice.fillers";
import { voiceService, type VoiceService } from "./voice.service";

/**
 * Streams generated speech to the browser as it is produced (playback starts sooner), or sends cached audio.
 * A complete clip is handed to `remember` so it is never paid for twice.
 */
export async function sendSpeech(
  res: Response,
  voice: VoiceService,
  { text, agent, cached, remember }: { text: string; agent: AgentName; cached?: Buffer; remember: (audio: Buffer) => void },
) {
  const audioHeaders = () => {
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "private, max-age=3600");
  };
  if (cached) {
    audioHeaders();
    res.end(cached);
    return;
  }

  // Headers only after generation has started, so a failure still returns a normal JSON error.
  const upstream = await voice.synthesize(text, agent);
  audioHeaders();
  const chunks: Buffer[] = [];
  const audio = Readable.fromWeb(upstream.body as WebReadableStream<Uint8Array>);
  audio.on("data", (chunk: Buffer) => chunks.push(chunk));
  audio.on("end", () => remember(Buffer.concat(chunks)));
  audio.on("error", (err) => {
    logger.error({ err }, "Speech stream failed");
    res.destroy(err);
  });
  // A customer who interrupts closes the request; stop downloading audio nobody will hear.
  res.on("close", () => audio.destroy());
  audio.pipe(res);
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
