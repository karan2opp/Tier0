let context: AudioContext | null = null;

function tone(ctx: AudioContext, frequency: number, start: number, duration: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

/** A short two-note chime played when the call is transferred to another agent. */
export function playTransferChime(): Promise<void> {
  try {
    context ??= new AudioContext();
    const now = context.currentTime;
    tone(context, 660, now, 0.18);
    tone(context, 880, now + 0.16, 0.24);
  } catch {
    // Audio is a nicety; the call works without it.
  }
  return new Promise((resolve) => setTimeout(resolve, 450));
}
