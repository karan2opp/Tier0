import { BadRequestError, logger, ServiceUnavailableError } from "../../common";
import type { AgentName } from "../conversations/conversations.schema";

const OPENAI_URL = "https://api.openai.com/v1";
const TIMEOUT_MS = 30_000;
/** Agent replies are a few sentences; anything longer is not one of ours. */
const MAX_SPEECH_CHARS = 1200;
/** About a minute of 16 kHz mono WAV. */
export const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const MAX_CACHED_LINES = 100;

/** Each agent sounds like a different person, so a transfer is easy to hear. */
const VOICES: Record<AgentName, { voice: string; style: string }> = {
  front_desk: {
    voice: "coral",
    style: "A warm, welcoming support receptionist. Friendly and clear, at a relaxed, natural pace.",
  },
  troubleshoot: {
    voice: "ash",
    style: "A calm, patient support engineer explaining things simply. Reassuring and steady.",
  },
  status: {
    voice: "sage",
    style: "An upbeat, organised repairs coordinator. Clear with dates and times.",
  },
  human_agent: {
    voice: "alloy",
    style: "A polite support assistant letting the customer know a person will join shortly.",
  },
};

const TRANSCRIBE_PROMPT =
  "A customer on a laptop support call. They may say a phone number like 9000000001, a laptop serial number " +
  "like NHQN4SI00134501, or a ticket number like T0-1043.";

export class VoiceService {
  // Replaying a line (e.g. after unmuting) must not pay for it twice.
  private readonly cache = new Map<string, Buffer>();

  get available(): boolean {
    return Boolean(process.env.OPENAI_API_KEY);
  }

  cached(key: string): Buffer | undefined {
    return this.cache.get(key);
  }

  remember(key: string, audio: Buffer) {
    this.cache.set(key, audio);
    if (this.cache.size > MAX_CACHED_LINES) this.cache.delete(this.cache.keys().next().value!);
  }

  /** Starts generating speech for an agent's line; the response body streams MP3 as it is generated. */
  async synthesize(text: string, agent: AgentName): Promise<Response> {
    this.ensureConfigured();
    const input = text.slice(0, MAX_SPEECH_CHARS);
    const { voice, style } = VOICES[agent];

    const res = await this.call("/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts",
        voice,
        input,
        instructions: style,
        response_format: "mp3",
      }),
    });
    logger.info({ agent, chars: input.length }, "Speech generated");
    return res;
  }

  /** Turns the customer's recorded speech into text. */
  async transcribe(audio: Buffer, mimeType: string): Promise<string> {
    this.ensureConfigured();
    if (audio.length === 0) throw new BadRequestError("No audio received");
    if (audio.length > MAX_AUDIO_BYTES) throw new BadRequestError("That recording is too long");

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)], { type: mimeType }), "speech.wav");
    form.append("model", process.env.OPENAI_STT_MODEL ?? "gpt-4o-mini-transcribe");
    form.append("language", "en");
    form.append("prompt", TRANSCRIBE_PROMPT);
    form.append("response_format", "json");

    const res = await this.call("/audio/transcriptions", { method: "POST", body: form });
    const { text } = (await res.json()) as { text?: string };
    logger.info({ bytes: audio.length, chars: text?.length ?? 0 }, "Speech transcribed");
    return (text ?? "").trim();
  }

  private async call(path: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${OPENAI_URL}${path}`, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new ServiceUnavailableError("The voice service could not be reached", { cause: err });
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      logger.error({ path, status: res.status, detail }, "OpenAI voice request failed");
      throw new ServiceUnavailableError("The voice service failed", {
        ...(process.env.NODE_ENV !== "production" && { details: { status: res.status, detail } }),
      });
    }
    return res;
  }

  private ensureConfigured() {
    if (!this.available) throw new ServiceUnavailableError("OpenAI voice is not configured on the server");
  }
}

export const voiceService = new VoiceService();
