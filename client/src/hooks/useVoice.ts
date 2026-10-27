import { useCallback, useEffect, useRef, useState } from "react";
import { AGENTS } from "../agents";
import { api, type AgentMessage, type AgentName, type FillerKind, type Fillers } from "../api";
import { MicRecorder } from "../audio/micRecorder";
import { isNoise } from "../audio/turnTaking";
import { playTransferChime } from "../sounds";
import { useSpeech } from "./useSpeech";

/** browser: free, the browser's own speech. openai: natural voices, generated and transcribed by OpenAI. */
export type VoiceEngine = "browser" | "openai";

/** interrupted: the customer cut in; `line` is the first line they did not hear in full. */
export type SpeakOutcome = { outcome: "done" } | { outcome: "interrupted"; line: AgentMessage };

export interface ReplyHooks {
  /** A line starts playing: show it now, so the screen matches what is heard. */
  onLine: (line: AgentMessage, position: number) => void;
  /** A line will not be read aloud (the customer is talking): show it anyway. */
  onSkip: (line: AgentMessage, position: number) => void;
  /** The call is being put through to another agent. */
  onTransfer?: (to: AgentName) => void;
}

/**
 * One thing to say. Everything audible goes through ONE queue and plays one item at a time, so voices never
 * overlap or cut each other off. Only the customer can cut the queue short, by pressing to talk.
 */
interface QueueItem {
  kind: "line" | "filler" | "transfer";
  agent: AgentName;
  text: string;
  /** OpenAI audio, requested as soon as the item is queued so it is ready when its turn comes. */
  audio?: HTMLAudioElement;
  onStart: () => void;
  /** Called exactly once: true if it played to the end, false if it was cut off or skipped. */
  onDone: (played: boolean) => void;
}

/** A short breath between two things being said, so lines don't run into each other. */
const GAP_MS = 300;
/** How long the "connecting you to..." moment lasts between two agents. */
const TRANSFER_PAUSE_MS = 900;
/** If an agent line has not started playing by now, the browser voice reads it instead (the server retries a
 * stalled line once, within about 24 seconds). */
const AUDIO_START_TIMEOUT_MS = 26_000;
const MIC_BLOCKED = "Microphone access is blocked. Allow it in your browser, or type instead.";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The call's voice. The agent's replies are spoken through one queue; the customer talks by holding a key or
 * button (hold-to-talk): pressing stops the agent at once, and only what is said while holding is sent.
 */
export function useVoice({
  engine,
  enabled,
  sessionId,
  onUtterance,
}: {
  engine: VoiceEngine;
  /** Voice turned on for this call (otherwise the customer types). */
  enabled: boolean;
  sessionId: string | null;
  /** The customer said something; `interrupted` when they talked over the agent to say it. */
  onUtterance: (text: string, interrupted: boolean) => void;
}) {
  const [speaking, setSpeaking] = useState(false);
  const [holding, setHolding] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The filler phrase being said right now ("Let me check that"), shown as a caption. */
  const [fillerText, setFillerText] = useState<string | null>(null);

  const onUtteranceRef = useRef(onUtterance);
  onUtteranceRef.current = onUtterance;
  const sessionRef = useRef(sessionId);
  sessionRef.current = sessionId;

  const recorder = useRef<MicRecorder | null>(null);
  const holdingRef = useRef(false);
  /** Set when the customer pressed to talk over the agent; their message is sent as an interruption. */
  const interrupted = useRef(false);

  /* ---------- The speaking queue ---------- */
  const queue = useRef<QueueItem[]>([]);
  const current = useRef<QueueItem | null>(null);
  /** Stops the item playing now. */
  const stopCurrent = useRef<(() => void) | null>(null);
  /** Set when the customer cut the current item short. */
  const currentCut = useRef(false);
  const pumping = useRef(false);

  const fillers = useRef<Fillers | null>(null);
  const fillerTurn = useRef<Partial<Record<FillerKind, number>>>({});
  const pendingTranscripts = useRef(0);

  const deliver = useCallback((text: string) => {
    const wasInterrupted = interrupted.current;
    interrupted.current = false;
    onUtteranceRef.current(text, wasInterrupted);
  }, []);

  const browser = useSpeech(deliver);
  const browserRef = useRef(browser);
  browserRef.current = browser;

  const isBusy = () => Boolean(current.current) || queue.current.length > 0;
  /** The customer is talking, or has said something not sent yet: nothing is spoken over them. */
  const customerTalking = () => holdingRef.current || pendingTranscripts.current > 0;

  /** Plays an audio element; resolves true if it played to the end. */
  const playAudio = (el: HTMLAudioElement) =>
    new Promise<boolean>((resolve) => {
      let settled = false;
      const stop = () => {
        el.pause();
        el.removeAttribute("src");
        el.load(); // cancels the download, so the server stops generating
      };
      // The voice service can be slow; rather than leave the call silent, give up and let the caller fall back.
      const stalled = setTimeout(() => {
        stop();
        done(false);
      }, AUDIO_START_TIMEOUT_MS);
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(stalled);
        el.onended = el.onerror = el.onplaying = null;
        resolve(ok);
      };
      el.onplaying = () => clearTimeout(stalled);
      el.onended = () => done(true);
      el.onerror = () => done(false);
      stopCurrent.current = () => {
        stop();
        done(false);
      };
      el.play().catch(() => done(false));
    });

  /** Says one item. OpenAI audio when there is some, the browser voice otherwise (also the fallback). */
  const playItem = async (item: QueueItem) => {
    if (item.kind === "transfer") {
      // A short "connecting" moment, like a call being put through, before the next agent speaks.
      stopCurrent.current = () => {};
      await playTransferChime();
      await sleep(TRANSFER_PAUSE_MS);
      return;
    }
    if (item.audio && (await playAudio(item.audio))) return;
    if (currentCut.current) return;
    stopCurrent.current = () => browserRef.current.cancelSpeech();
    await browserRef.current.speak(item.text, AGENTS[item.agent]);
  };

  /** Plays the queue to the end, one item at a time, with a short gap between items. */
  const pump = useCallback(async () => {
    if (pumping.current) return;
    pumping.current = true;
    try {
      while (queue.current.length > 0) {
        const item = queue.current.shift()!;
        // A filler only fills silence: if real words are already waiting, it is dropped.
        if (item.kind === "filler" && queue.current.some((next) => next.kind !== "filler")) {
          item.audio?.removeAttribute("src");
          item.onDone(false);
          continue;
        }
        // A filler is the agent speaking too, so nobody is told "your turn" while a reply waits behind it.
        setSpeaking(true);
        current.current = item;
        currentCut.current = false;
        item.onStart();

        await playItem(item);

        const played = !currentCut.current;
        current.current = null;
        stopCurrent.current = null;
        item.onDone(played);
        if (queue.current.length > 0) await sleep(GAP_MS);
      }
    } finally {
      pumping.current = false;
      setSpeaking(false);
    }
  }, [engine]);

  /** Empties the queue and stops what is playing. Everything not heard in full reports itself as not played. */
  const clearQueue = useCallback(() => {
    const pending = queue.current;
    queue.current = [];
    for (const item of pending) {
      item.audio?.removeAttribute("src");
      item.onDone(false);
    }
    if (current.current) {
      currentCut.current = true;
      stopCurrent.current?.();
    }
  }, []);

  /** Stops whatever is being said. Returns false if nothing was. */
  const interrupt = useCallback(() => {
    if (!isBusy()) return false;
    // Only real words count as an interruption (cutting off a filler is not worth telling the agent about).
    if ([current.current, ...queue.current].some((item) => item?.kind === "line")) interrupted.current = true;
    clearQueue();
    return true;
  }, [clearQueue]);

  const audioFor = (url: string | null) => {
    if (engine !== "openai" || !url) return undefined;
    const el = new Audio(url);
    el.preload = "auto";
    return el;
  };

  /**
   * Queues a reply to be spoken after anything already being said. Each line is shown as it starts; a transfer
   * between agents gets its "connecting" moment. Resolves when the whole reply has been said, or cut short.
   */
  const say = useCallback(
    (lines: AgentMessage[], hooks: ReplyHooks): Promise<SpeakOutcome> => {
      if (lines.length === 0) return Promise.resolve({ outcome: "done" });
      // The customer is talking: don't talk over them. Show the reply; their words become the next message.
      if (customerTalking()) {
        lines.forEach((line, i) => hooks.onSkip(line, i));
        return Promise.resolve({ outcome: "interrupted", line: lines[0] });
      }

      return new Promise((resolve) => {
        const items: QueueItem[] = [];
        let firstMissed: number | null = null;
        let remaining = 0;
        const settle = () => {
          remaining -= 1;
          if (remaining > 0) return;
          resolve(firstMissed === null ? { outcome: "done" } : { outcome: "interrupted", line: lines[firstMissed] });
        };

        lines.forEach((line, i) => {
          if (i > 0 && line.agent !== lines[i - 1].agent) {
            items.push({
              kind: "transfer",
              agent: line.agent,
              text: "",
              onStart: () => hooks.onTransfer?.(line.agent),
              onDone: settle,
            });
          }
          let started = false;
          const url = line.index !== undefined && sessionRef.current ? api.speechUrl(sessionRef.current, line.index) : null;
          items.push({
            kind: "line",
            agent: line.agent,
            text: line.text,
            audio: audioFor(url),
            onStart: () => {
              started = true;
              hooks.onLine(line, i);
            },
            onDone: (played) => {
              if (!played) {
                firstMissed = firstMissed === null ? i : Math.min(firstMissed, i);
                if (!started) hooks.onSkip(line, i);
              }
              settle();
            },
          });
        });

        remaining = items.length;
        queue.current.push(...items);
        void pump();
      });
    },
    [engine, pump],
  );

  useEffect(() => {
    if (!enabled) return;
    api
      .fillers()
      .then((list) => (fillers.current = list))
      .catch(() => {});
  }, [enabled]);

  /**
   * Says a short filler phrase in the agent's voice while it works ("Okay, let me check that for you."), so the
   * line never goes quiet. Only into silence: never over the customer, never ahead of real words.
   */
  const fill = useCallback(
    (kind: FillerKind, agent: AgentName) => {
      const list = fillers.current?.[kind];
      if (!list?.length || agent === "human_agent" || isBusy() || customerTalking()) return;
      const index = ((fillerTurn.current[kind] ?? -1) + 1) % list.length;
      fillerTurn.current[kind] = index;
      const text = list[index];
      queue.current.push({
        kind: "filler",
        agent,
        text,
        audio: audioFor(api.fillerUrl(agent, kind, index)),
        onStart: () => setFillerText(text),
        onDone: () => setFillerText(null),
      });
      void pump();
    },
    [engine, pump],
  );

  // OpenAI voice: the microphone opens once for the call; audio is only kept while the customer holds to talk.
  useEffect(() => {
    if (!enabled || engine !== "openai" || typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      return;
    }
    const mic = new MicRecorder();
    recorder.current = mic;
    mic.start().catch(() => {
      recorder.current = null;
      setError(MIC_BLOCKED);
    });
    return () => {
      mic.stop();
      recorder.current = null;
    };
  }, [enabled, engine]);

  /** Sends the customer's recording for transcription; noise ("um", or words invented from silence) is dropped. */
  const transcribe = (wav: Blob) => {
    const session = sessionRef.current;
    if (!session) return;
    pendingTranscripts.current += 1;
    setTranscribing(true);
    api
      .transcribe(session, wav)
      .then((text) => {
        if (text && !isNoise(text)) {
          setError(null);
          deliver(text);
        } else {
          interrupted.current = false;
        }
      })
      .catch(() => setError("Sorry, I couldn't catch that. Please try again, or type it."))
      .finally(() => {
        pendingTranscripts.current -= 1;
        if (pendingTranscripts.current === 0) setTranscribing(false);
      });
  };

  /** Pressed to talk: the agent stops at once, and only what is said while holding is recorded. */
  const pressTalk = useCallback(() => {
    if (holdingRef.current) return;
    if (engine === "openai" && !recorder.current?.ready) {
      setError(MIC_BLOCKED);
      return;
    }
    holdingRef.current = true;
    setHolding(true);
    setError(null);
    interrupt();
    if (engine === "openai") recorder.current!.begin();
    else browserRef.current.listen();
  }, [engine, interrupt]);

  /** Released: what they said is sent. */
  const releaseTalk = useCallback(() => {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    setHolding(false);
    if (engine === "openai") {
      const wav = recorder.current?.end() ?? null;
      if (wav) transcribe(wav);
      else interrupted.current = false;
    } else {
      browserRef.current.stopListening();
    }
  }, [engine]);

  /** Throws away what is being said (the customer typed instead). */
  const cancelTalk = useCallback(() => {
    holdingRef.current = false;
    setHolding(false);
    recorder.current?.cancel();
    browserRef.current.abortListening();
  }, []);

  /** Silence everything (e.g. the call ended). */
  const stopAll = useCallback(() => {
    clearQueue();
    cancelTalk();
  }, [clearQueue, cancelTalk]);

  useEffect(() => () => clearQueue(), [clearQueue]);

  return {
    say,
    fill,
    fillerText,
    holding,
    pressTalk,
    releaseTalk,
    canTalk: enabled && (engine === "openai" || browser.canListen),
    speaking,
    transcribing,
    interim: browser.interim,
    error: error ?? browser.micError ?? browser.voiceError,
    interrupt,
    cancelTalk,
    stopAll,
  };
}
