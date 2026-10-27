/**
 * Hold-to-talk recorder. The microphone stays open during the call, but audio is only kept between press and
 * release, plus a fraction of a second from just before the press, so the first word is never clipped.
 * The recording is returned as a 16 kHz mono WAV, which is all a transcriber needs.
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

const PREROLL_MS = 300;
/** Shorter than this is a slip of the finger, not speech. */
const MIN_RECORDING_MS = 400;
const MAX_RECORDING_MS = 30_000;
const TARGET_RATE = 16_000;

export class MicRecorder {
  private ctx?: AudioContext;
  private stream?: MediaStream;
  private stopped = false;
  private recording = false;
  private recordedMs = 0;
  private preroll: Float32Array[] = [];
  private chunks: Float32Array[] = [];

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

    const source = ctx.createMediaStreamSource(stream);
    const tap = new AudioWorkletNode(ctx, "tier0-mic-tap");
    tap.port.onmessage = (event) => this.process(event.data as Float32Array);
    // Connected through a muted gain so the browser keeps processing it; the mic is never played back.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(tap).connect(mute).connect(ctx.destination);
    if (ctx.state === "suspended") await ctx.resume();
  }

  get ready() {
    return Boolean(this.stream);
  }

  /** Pressed: record from now (plus the moment just before) until release. */
  begin() {
    if (this.recording) return;
    void this.ctx?.resume();
    this.recording = true;
    this.chunks = this.preroll;
    this.recordedMs = 0;
    this.preroll = [];
  }

  /** Released: the recording, or null if it was too short to be speech. */
  end(): Blob | null {
    if (!this.recording) return null;
    this.recording = false;
    const wav = this.recordedMs >= MIN_RECORDING_MS ? encodeWav(this.chunks, this.ctx?.sampleRate ?? 48_000) : null;
    this.chunks = [];
    return wav;
  }

  /** Throws away what is being recorded. */
  cancel() {
    this.recording = false;
    this.chunks = [];
  }

  stop() {
    this.stopped = true;
    this.cancel();
    this.stream?.getTracks().forEach((track) => track.stop());
    void this.ctx?.close().catch(() => {});
  }

  private process(chunk: Float32Array) {
    const ms = (chunk.length / (this.ctx?.sampleRate ?? 48_000)) * 1000;
    if (this.recording) {
      if (this.recordedMs < MAX_RECORDING_MS) {
        this.chunks.push(chunk);
        this.recordedMs += ms;
      }
      return;
    }
    this.preroll.push(chunk);
    while (this.preroll.length * ms > PREROLL_MS) this.preroll.shift();
  }
}

/** Float samples at the mic's rate -> 16-bit PCM WAV at 16 kHz (small uploads). */
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
