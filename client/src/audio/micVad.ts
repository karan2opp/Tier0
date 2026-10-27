/**
 * Microphone + voice activity detection (VAD).
 *
 * Listens continuously and reports when the customer starts and stops talking. Each stretch of speech is
 * returned as a 16 kHz mono WAV (with a little audio from just before speech began, so first words are kept).
 * While an agent is speaking, "guarded" mode needs louder, longer speech, so the agent's own voice coming
 * out of the speakers is less likely to count as the customer interrupting.
 */

const WORKLET = `
class Tier0MicTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(1024); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor("tier0-mic-tap", Tier0MicTap);
`;

const PREROLL_MS = 350;
const MIN_THRESHOLD = 0.012;
const START_MS = 150;
const GUARDED_START_MS = 320;
const GUARDED_FACTOR = 2.6;
const END_SILENCE_MS = 900;
const MAX_SEGMENT_MS = 25_000;
const MIN_SPEECH_MS = 300;
const TARGET_RATE = 16_000;

export interface VadCallbacks {
  onSpeechStart: () => void;
  /** The finished recording, or null when it was too short to be speech (a cough, a click). */
  onSpeechEnd: (wav: Blob | null) => void;
}

export class MicVad {
  private ctx?: AudioContext;
  private stream?: MediaStream;
  private stopped = false;
  private guarded = false;
  private floor = 0.004;
  private aboveMs = 0;
  private speaking = false;
  private silenceMs = 0;
  private segmentMs = 0;
  private preroll: Float32Array[] = [];
  private segment: Float32Array[] = [];

  constructor(private readonly callbacks: VadCallbacks) {}

  async start() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    // Stopped while the browser was asking for permission: release the mic straight away.
    if (this.stopped) return stream.getTracks().forEach((track) => track.stop());
    this.stream = stream;
    const ctx = new AudioContext();
    this.ctx = ctx;
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);

    const source = ctx.createMediaStreamSource(this.stream);
    const tap = new AudioWorkletNode(ctx, "tier0-mic-tap");
    tap.port.onmessage = (event) => this.process(event.data as Float32Array);
    // Connected through a muted gain so the browser keeps processing it; the mic is never played back.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(tap).connect(mute).connect(ctx.destination);
    if (ctx.state === "suspended") await ctx.resume();
  }

  setGuarded(guarded: boolean) {
    this.guarded = guarded;
    this.aboveMs = 0;
  }

  /** Ends the current recording now (e.g. the customer tapped "send"). */
  flush() {
    if (this.speaking) this.finish();
  }

  /** Throws away anything being recorded. */
  reset() {
    this.speaking = false;
    this.aboveMs = 0;
    this.segment = [];
    this.segmentMs = 0;
  }

  get isSpeaking() {
    return this.speaking;
  }

  stop() {
    this.stopped = true;
    this.stream?.getTracks().forEach((track) => track.stop());
    void this.ctx?.close().catch(() => {});
    this.reset();
  }

  private process(chunk: Float32Array) {
    const rate = this.ctx?.sampleRate ?? 48_000;
    const ms = (chunk.length / rate) * 1000;
    let sum = 0;
    for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
    const rms = Math.sqrt(sum / chunk.length);
    const threshold = Math.max(MIN_THRESHOLD, this.floor * 3);

    if (!this.speaking) {
      this.preroll.push(chunk);
      while (this.preroll.length * ms > PREROLL_MS) this.preroll.shift();
      // Learn the room's background noise from quiet moments only.
      if (rms < threshold) this.floor = this.floor * 0.97 + rms * 0.03;

      const start = threshold * (this.guarded ? GUARDED_FACTOR : 1);
      this.aboveMs = rms > start ? this.aboveMs + ms : Math.max(0, this.aboveMs - ms * 2);
      if (this.aboveMs >= (this.guarded ? GUARDED_START_MS : START_MS)) {
        this.speaking = true;
        this.segment = this.preroll;
        this.segmentMs = this.preroll.length * ms;
        this.preroll = [];
        this.silenceMs = 0;
        this.callbacks.onSpeechStart();
      }
      return;
    }

    this.segment.push(chunk);
    this.segmentMs += ms;
    this.silenceMs = rms < threshold * 0.7 ? this.silenceMs + ms : 0;
    if (this.silenceMs >= END_SILENCE_MS || this.segmentMs >= MAX_SEGMENT_MS) this.finish();
  }

  private finish() {
    const spokenMs = this.segmentMs - this.silenceMs - PREROLL_MS;
    const wav = spokenMs >= MIN_SPEECH_MS ? encodeWav(this.segment, this.ctx?.sampleRate ?? 48_000) : null;
    this.reset();
    this.callbacks.onSpeechEnd(wav);
  }
}

/** Float samples at the mic's rate -> 16-bit PCM WAV at 16 kHz (small uploads, all a transcriber needs). */
function encodeWav(chunks: Float32Array[], rate: number): Blob {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const input = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    input.set(chunk, offset);
    offset += chunk.length;
  }

  const ratio = rate / TARGET_RATE;
  const length = Math.floor(input.length / ratio);
  const pcm = new Int16Array(length);
  for (let i = 0; i < length; i++) {
    const from = Math.floor(i * ratio);
    const to = Math.min(input.length, Math.floor((i + 1) * ratio));
    let acc = 0;
    for (let j = from; j < to; j++) acc += input[j];
    const sample = Math.max(-1, Math.min(1, acc / Math.max(1, to - from)));
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const write = (at: number, text: string) => [...text].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
  write(0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, TARGET_RATE, true);
  view.setUint32(28, TARGET_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, pcm.length * 2, true);
  new Int16Array(buffer, 44).set(pcm);
  return new Blob([buffer], { type: "audio/wav" });
}
