import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentMeta } from "../agents";

/* Minimal typings: the Web Speech recognition API is not in TypeScript's DOM lib. */
interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

const getRecognition = (): RecognitionCtor | undefined =>
  typeof window === "undefined"
    ? undefined
    : ((window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor })
        .SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition);

/**
 * Browsers only allow speech that starts from a click. Call this inside a click handler (e.g. "Start call"),
 * so replies that arrive later, after a network request, are allowed to play.
 */
export function unlockSpeech() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  synth.resume();
  const primer = new SpeechSynthesisUtterance(" ");
  primer.volume = 0;
  synth.speak(primer);
}

/** Chrome stops long utterances after ~15 seconds, so replies are spoken sentence by sentence. */
const sentences = (text: string) => text.match(/[^.!?]+[.!?]*\s*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];

export function useSpeech(onFinal: (text: string) => void) {
  const Ctor = getRecognition();
  const canListen = Boolean(Ctor);
  const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;

  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [interim, setInterim] = useState("");
  const [micError, setMicError] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  const recognition = useRef<Recognition | null>(null);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;
  /** Bumped on cancel, so a cancelled reply stops queueing sentences. */
  const speechRun = useRef(0);

  useEffect(() => {
    if (!canSpeak) return;
    const load = () => setVoices(window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en")));
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", load);
      window.speechSynthesis.cancel();
    };
  }, [canSpeak]);

  /** Hold-to-talk is held down: keep listening (Chrome ends sessions now and then; they are restarted). */
  const keepListening = useRef(false);
  /** Released: the last words are still arriving; send everything once recognition has finished. */
  const releasing = useRef(false);
  /** Everything heard since the press, across restarts. */
  const heard = useRef("");
  const pending = useRef("");
  const releaseTimer = useRef<ReturnType<typeof setTimeout>>();

  const sendHeard = useCallback(() => {
    clearTimeout(releaseTimer.current);
    releasing.current = false;
    const text = `${heard.current} ${pending.current}`.trim();
    heard.current = "";
    pending.current = "";
    setInterim("");
    if (text) onFinalRef.current(text);
  }, []);

  const startSession = useCallback(() => {
    if (!Ctor || recognition.current) return;
    const rec = new Ctor();
    rec.lang = "en-IN";
    rec.interimResults = true;
    rec.continuous = true;

    rec.onresult = (event) => {
      pending.current = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) heard.current = `${heard.current} ${result[0].transcript}`.trim();
        else pending.current += result[0].transcript;
      }
      setInterim(`${heard.current} ${pending.current}`.trim());
    };
    rec.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        keepListening.current = false;
        setMicError("Microphone access is blocked. Allow it in your browser, or type instead.");
      }
    };
    rec.onend = () => {
      recognition.current = null;
      if (keepListening.current) {
        setTimeout(() => keepListening.current && startSessionRef.current(), 100);
        return;
      }
      setListening(false);
      if (releasing.current) sendHeard();
    };

    recognition.current = rec;
    setMicError(null);
    setListening(true);
    try {
      rec.start();
    } catch {
      recognition.current = null;
      setListening(false);
    }
  }, [Ctor, sendHeard]);
  const startSessionRef = useRef(startSession);
  startSessionRef.current = startSession;

  /** Pressed: start listening, from a clean slate. */
  const listen = useCallback(() => {
    if (!Ctor) return;
    if (!keepListening.current && !releasing.current) {
      heard.current = "";
      pending.current = "";
    }
    keepListening.current = true;
    startSession();
  }, [Ctor, startSession]);

  /** Released: stop listening and send everything heard (once the last words have come in). */
  const stopListening = useCallback(() => {
    keepListening.current = false;
    releasing.current = true;
    if (!recognition.current) return sendHeard();
    recognition.current.stop();
    // If the browser never reports the end, send what we have anyway.
    releaseTimer.current = setTimeout(sendHeard, 1500);
  }, [sendHeard]);

  /** Stops listening and throws away what was heard. */
  const abortListening = useCallback(() => {
    keepListening.current = false;
    releasing.current = false;
    clearTimeout(releaseTimer.current);
    heard.current = "";
    pending.current = "";
    setInterim("");
    const rec = recognition.current;
    if (!rec) return;
    rec.onend = null;
    rec.abort();
    recognition.current = null;
    setListening(false);
  }, []);

  const pickVoice = useCallback(
    (meta: AgentMeta) => {
      // Voices installed on the device first: Chrome's online "Google" voices often fail silently.
      const ordered = [...voices.filter((v) => v.localService), ...voices.filter((v) => !v.localService)];
      for (const name of meta.voice.preferred) {
        const voice = ordered.find((v) => v.name.toLowerCase().includes(name.toLowerCase()));
        if (voice) return voice;
      }
      return ordered.find((v) => v.lang === "en-IN") ?? ordered[0];
    },
    [voices],
  );

  /**
   * Speaks one sentence. Resolves when it ends, or early if the engine never starts it (then false),
   * so a broken voice can never leave the call stuck on "Speaking".
   */
  const say = (sentence: string, meta: AgentMeta, voice: SpeechSynthesisVoice | undefined) =>
    new Promise<boolean>((resolve) => {
      const synth = window.speechSynthesis;
      const utterance = new SpeechSynthesisUtterance(sentence);
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang ?? "en-IN";
      utterance.volume = 1;
      utterance.pitch = meta.voice.pitch;
      utterance.rate = meta.voice.rate;

      let started = false;
      const words = sentence.split(/\s+/).length;
      const finish = (ok: boolean) => {
        clearTimeout(startTimer);
        clearTimeout(endTimer);
        resolve(ok);
      };
      utterance.onstart = () => (started = true);
      utterance.onend = () => finish(started);
      utterance.onerror = (event) => finish(event.error === "interrupted" || event.error === "canceled");
      const startTimer = setTimeout(() => !started && (synth.cancel(), finish(false)), 2500);
      const endTimer = setTimeout(() => finish(started), 4000 + words * 700);

      // Chrome can get stuck in a paused state, where nothing plays until it is resumed.
      synth.resume();
      synth.speak(utterance);
    });

  /** Speaks a reply in the agent's voice; resolves when it is done or cancelled. */
  const speak = useCallback(
    async (text: string, meta: AgentMeta) => {
      if (!canSpeak) return;
      const run = ++speechRun.current;
      let voice: SpeechSynthesisVoice | undefined = pickVoice(meta);
      setSpeaking(true);
      for (const sentence of sentences(text)) {
        if (run !== speechRun.current) break;
        if (await say(sentence, meta, voice)) continue;
        if (run !== speechRun.current) break;
        // That voice did not play: fall back to the browser's default voice for the rest of the reply.
        if (voice && (await say(sentence, meta, undefined))) {
          voice = undefined;
          continue;
        }
        setVoiceError("Your browser didn't play the agent's voice. Check your volume, or read the captions.");
        break;
      }
      if (run === speechRun.current) setSpeaking(false);
    },
    [canSpeak, pickVoice],
  );

  const cancelSpeech = useCallback(() => {
    speechRun.current++;
    if (canSpeak) {
      window.speechSynthesis.cancel();
      // A cancel while paused can leave the engine paused, and the next reply would be silent.
      window.speechSynthesis.resume();
    }
    setSpeaking(false);
  }, [canSpeak]);

  /** Holds the agent mid-sentence (e.g. while checking whether the customer is cutting in). */
  const pauseSpeech = useCallback(() => {
    if (canSpeak) window.speechSynthesis.pause();
  }, [canSpeak]);

  const resumeSpeech = useCallback(() => {
    if (canSpeak) window.speechSynthesis.resume();
  }, [canSpeak]);

  useEffect(() => () => recognition.current?.abort(), []);

  return {
    canListen,
    canSpeak,
    listening,
    speaking,
    interim,
    micError,
    voiceError,
    listen,
    stopListening,
    abortListening,
    speak,
    cancelSpeech,
    pauseSpeech,
    resumeSpeech,
  };
}
