import { BadRequestError, logger, ServiceUnavailableError } from "../../common";
import type { AgentName } from "../conversations/conversations.schema";

const OPENAI_URL = "https://api.openai.com/v1";
const TIMEOUT_MS = 30_000;
/** One agent line is a few seconds of audio; an attempt taking longer than this has stalled. */
const SPEECH_ATTEMPT_MS = 12_000;
const SPEECH_ATTEMPTS = 2;
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

/** Whether a transcript is (part of) the transcription prompt rather than speech. */
function echoesPrompt(text: string): boolean {
  const said = text.toLowerCase();
  return /^\s*context\s*:/.test(said) || said.includes("customer on a laptop support call") || said.includes("they may say a phone number");
}

export class VoiceService {
  // Replaying a line (e.g. after unmuting) must not pay for it twice.
  private readonly cache = new Map<string, Buffer>();

  get available(): boolean {
    return Boolean(process.env.OPENAI_API_KEY);
  }

  cached(key: string): Buffer | undefined {
    return this.cache.get(key);
  }

  /** Filler phrases are fixed text, so their audio is kept for good (a few dozen short clips at most). */
  private readonly fillerAudio = new Map<string, Buffer>();

  fillerCached(key: string): Buffer | undefined {
    return this.fillerAudio.get(key);
  }

  rememberFiller(key: string, audio: Buffer) {
    this.fillerAudio.set(key, audio);
  }

  remember(key: string, audio: Buffer) {
    this.cache.set(key, audio);
    if (this.cache.size > MAX_CACHED_LINES) this.cache.delete(this.cache.keys().next().value!);
  }

  /** Starts generating speech for an agent's line; the response body streams MP3 as it is generated. */
  /**
   * The complete audio for one agent line. OpenAI's audio stream sometimes stalls part-way, which would freeze the
   * call, so each attempt must finish within a time limit, and a stalled attempt is retried once.
   */
  async synthesize(text: string, agent: AgentName): Promise<Buffer> {
    this.ensureConfigured();
    const input = text.slice(0, MAX_SPEECH_CHARS);
    const { voice, style } = VOICES[agent];
    const body = JSON.stringify({
      model: process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts",
      voice,
      input,
      instructions: style,
      response_format: "mp3",
    });

    for (let attempt = 1; ; attempt++) {
      try {
        const res = await this.call(
          "/audio/speech",
          { method: "POST", headers: { "Content-Type": "application/json" }, body },
          SPEECH_ATTEMPT_MS,
        );
        const audio = Buffer.from(await res.arrayBuffer());
        logger.info({ agent, chars: input.length, bytes: audio.length, attempt }, "Speech generated");
        return audio;
      } catch (err) {
        if (attempt >= SPEECH_ATTEMPTS) throw err;
        logger.warn({ agent, attempt, err: (err as Error).message }, "Speech stalled or failed; retrying");
      }
    }
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
    // On near-silent audio the transcriber can echo its own prompt back; that is not something the customer said.
    if (echoesPrompt(text ?? "")) {
      logger.warn("Transcript echoed the prompt; treated as silence");
      return "";
    }
    return (text ?? "").trim();
  }

  private async call(path: string, init: RequestInit, timeoutMs = TIMEOUT_MS): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${OPENAI_URL}${path}`, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        // Covers reading the body too, so a stream that stalls part-way is cut off.
        signal: AbortSignal.timeout(timeoutMs),
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
