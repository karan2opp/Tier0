import { useCallback, useEffect, useRef, useState } from "react";
import { AGENTS } from "../agents";
import { api, type AgentMessage, type AgentName, type FillerKind, type Fillers } from "../api";
import { MicVad } from "../audio/micVad";
import { isUnfinished, UNFINISHED_PAUSE_MS } from "../audio/turnTaking";
import { playTransferChime } from "../sounds";
import { useSpeech } from "./useSpeech";

/** browser: free, the browser's own speech. openai: natural voices, generated and transcribed by OpenAI. */
export type VoiceEngine = "browser" | "openai";

export type SpeakOutcome = { outcome: "done" } | { outcome: "interrupted"; line: AgentMessage };

/**
 * What the microphone is for right now:
 * idle: nobody's turn (the agents are thinking), speech is ignored.
 * speaking: an agent is talking; customer speech interrupts it.
 * listening: the customer's turn (OpenAI engine); their next speech is recorded and transcribed.
 */
type MicMode = "idle" | "speaking" | "listening";

/** How long the "connecting you to..." moment lasts between two agents. */
const TRANSFER_PAUSE_MS = 900;

/** Speech that is mostly the agent's own words came from the speakers, not the customer. */
function looksLikeEcho(heard: string, spoken: string): boolean {
  const words = (text: string) => text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  const heardWords = words(heard);
  if (heardWords.length < 3) return false;
  const spokenWords = new Set(words(spoken));
  return heardWords.filter((w) => spokenWords.has(w)).length / heardWords.length >= 0.8;
}

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
  const [listening, setListening] = useState(false);
  const [hearing, setHearing] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The filler phrase being said right now ("Let me check that"), shown as a caption. */
  const [fillerText, setFillerText] = useState<string | null>(null);
  const fillers = useRef<Fillers | null>(null);
  const fillerTurn = useRef<Partial<Record<FillerKind, number>>>({});
  const fillerPlaying = useRef(false);

  const onUtteranceRef = useRef(onUtterance);
  onUtteranceRef.current = onUtterance;
  const sessionRef = useRef(sessionId);
  sessionRef.current = sessionId;

  const mode = useRef<MicMode>("idle");
  const vad = useRef<MicVad | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  /** Set when the customer talks over the agent; the next thing they say is sent as an interruption. */
  const interrupted = useRef(false);
  /** Ends the reply being spoken; set while speaking. */
  const stopSpeaking = useRef<(() => void) | null>(null);
  /** The line being spoken, to spot our own voice echoing back into the mic. */
  const lastSpoken = useRef("");

  /** OpenAI transcriptions, chained so they are delivered in the order they were spoken. */
  const transcriptions = useRef(Promise.resolve());
  const pendingTranscripts = useRef(0);
  /** An unfinished sentence ("...and"), held briefly in case the customer carries on. */
  const held = useRef("");
  const holdTimer = useRef<ReturnType<typeof setTimeout>>();
  /** Bumped by every new reply, so an older reply still being spoken stops. */
  const speakRun = useRef(0);

  const deliver = useCallback((text: string) => {
    const wasInterrupted = interrupted.current;
    interrupted.current = false;
    onUtteranceRef.current(text, wasInterrupted);
  }, []);

  /** They did not carry on after all: send what they said. */
  const releaseHeld = useCallback(() => {
    const text = held.current;
    held.current = "";
    if (text) deliver(text);
  }, [deliver]);

  const browser = useSpeech(deliver);
  const browserRef = useRef(browser);
  browserRef.current = browser;

  const setMode = (next: MicMode) => {
    mode.current = next;
    vad.current?.setGuarded(next === "speaking");
    setListening(next === "listening");
  };

  /** Stops the agent mid-sentence because the customer started talking. */
  const interrupt = useCallback(() => {
    if (!stopSpeaking.current) return;
    interrupted.current = true;
    stopSpeaking.current();
  }, []);

  // The microphone stays open for the whole call: it records the customer (OpenAI engine) and,
  // in both engines, notices when they start talking over the agent.
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return;
    const mic = new MicVad({
      onSpeechStart: () => {
        // Never talk over the customer, not even with a filler.
        if (fillerPlaying.current) stopSpeaking.current?.();
        if (mode.current === "speaking") {
          interrupt();
          if (engine === "openai") {
            setMode("listening");
            setHearing(true);
          } else {
            vad.current?.reset();
            browserRef.current.listen();
          }
          return;
        }
        if (mode.current === "listening" && engine === "openai") {
          // They are carrying on: wait for the rest instead of sending the unfinished part.
          clearTimeout(holdTimer.current);
          setHearing(true);
        } else vad.current?.reset();
      },
      onSpeechEnd: (wav) => {
        setHearing(false);
        if (engine !== "openai" || mode.current !== "listening" || !wav || !sessionRef.current) return;
        // Keep listening while this is transcribed and answered: anything the customer adds is sent too,
        // and the server folds it into the same answer. Transcriptions run in order, one at a time.
        const session = sessionRef.current;
        pendingTranscripts.current += 1;
        setTranscribing(true);
        transcriptions.current = transcriptions.current.then(async () => {
          try {
            const text = await api.transcribe(session, wav);
            if (!text || looksLikeEcho(text, lastSpoken.current)) return;
            const sofar = held.current ? `${held.current} ${text}` : text;
            clearTimeout(holdTimer.current);
            if (isUnfinished(sofar)) {
              // "My battery drains fast and..." - give them a moment to finish before answering.
              held.current = sofar;
              holdTimer.current = setTimeout(releaseHeld, UNFINISHED_PAUSE_MS);
              return;
            }
            held.current = "";
            setError(null);
            deliver(sofar);
          } catch {
            setError("Sorry, I couldn't catch that. Please say it again, or type it.");
          } finally {
            pendingTranscripts.current -= 1;
            if (pendingTranscripts.current === 0) setTranscribing(false);
          }
        });
      },
    });
    vad.current = mic;
    mic.start().catch(() => {
      vad.current = null;
      setError(
        engine === "openai"
          ? "Microphone access is blocked. Allow it in your browser, or type instead."
          : "Interruptions need microphone access; you can still tap the mic to talk.",
      );
    });
    return () => {
      mic.stop();
      vad.current = null;
    };
  }, [enabled, engine, interrupt, deliver, releaseHeld]);

  /** Plays one line from OpenAI audio. Resolves false if it could not be played (the caller falls back). */
  const playOpenAI = (line: AgentMessage, preloaded?: HTMLAudioElement) =>
    new Promise<boolean>((resolve) => {
      const el = preloaded ?? new Audio(api.speechUrl(sessionRef.current!, line.index!));
      audio.current = el;
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        el.onended = el.onerror = null;
        resolve(ok);
      };
      el.onended = () => done(true);
      el.onerror = () => done(false);
      stopSpeaking.current = () => {
        el.pause();
        el.removeAttribute("src");
        el.load(); // cancels the download, so the server stops generating
        done(true);
      };
      el.play().catch(() => done(false));
    });

  /**
   * Speaks a reply line by line (a chime marks a transfer to another agent). Stops at once if the customer
   * interrupts, and says which line they cut off.
   */
  const speak = useCallback(
    async (
      lines: AgentMessage[],
      onLine: (line: AgentMessage) => void,
      onTransfer?: (to: AgentMessage["agent"]) => void,
    ): Promise<SpeakOutcome> => {
      // A newer reply replaces one that is still being spoken.
      const run = ++speakRun.current;
      stopSpeaking.current?.();

      // The customer is mid-sentence, or has said something we have not sent yet: this reply is already out
      // of date, so it is shown but not spoken over them. Their words become the next message.
      const customerTalking =
        vad.current?.isSpeaking ||
        pendingTranscripts.current > 0 ||
        Boolean(held.current) ||
        (engine === "browser" && Boolean(browserRef.current.interim));
      if (customerTalking && lines.length > 0) {
        onLine(lines[lines.length - 1]);
        return { outcome: "interrupted", line: lines[0] };
      }

      // Browser recognition would hear the agent's own voice, so it pauses while the agent talks.
      if (engine === "browser") browserRef.current.abortListening();
      interrupted.current = false;
      setMode("speaking");
      setSpeaking(true);
      // Start generating every OpenAI line at once, so the second agent after a transfer is ready to talk.
      const preloaded =
        engine === "openai" && sessionRef.current
          ? lines.map((line) => {
              if (line.index === undefined) return undefined;
              const el = new Audio(api.speechUrl(sessionRef.current!, line.index));
              el.preload = "auto";
              return el;
            })
          : [];

      try {
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (i > 0 && line.agent !== lines[i - 1].agent) {
            // A short "connecting" moment, like a call being put through, before the next agent speaks.
            onTransfer?.(line.agent);
            await playTransferChime();
            await new Promise((resolve) => setTimeout(resolve, TRANSFER_PAUSE_MS));
          }
          if (run !== speakRun.current) return { outcome: "done" };
          if (interrupted.current) return { outcome: "interrupted", line: lines[i - 1] ?? line };
          lastSpoken.current = line.text;
          onLine(line);

          let played = false;
          if (engine === "openai" && line.index !== undefined && sessionRef.current) {
            played = await playOpenAI(line, preloaded[i]);
          }
          if (run !== speakRun.current) return { outcome: "done" };
          if (!played && !interrupted.current) {
            // Browser voice: also the fallback if OpenAI audio failed.
            stopSpeaking.current = () => browserRef.current.cancelSpeech();
            await browserRef.current.speak(line.text, AGENTS[line.agent]);
          }
          if (interrupted.current) return { outcome: "interrupted", line };
        }
        return { outcome: "done" };
      } finally {
        preloaded.forEach((el) => {
          if (el && el !== audio.current) el.removeAttribute("src");
        });
        // A newer reply has taken over; leave its state alone.
        if (run === speakRun.current) {
          stopSpeaking.current = null;
          setSpeaking(false);
          if (mode.current === "speaking") setMode("idle");
        }
      }
    },
    [engine],
  );

  /** The customer's turn: record their next sentence (OpenAI) or start speech recognition (browser). */
  useEffect(() => {
    if (!enabled) return;
    api
      .fillers()
      .then((list) => (fillers.current = list))
      .catch(() => {});
  }, [enabled]);

  /**
   * Says a short filler phrase in the agent's voice while it works ("Okay, let me check that for you."), so the
   * line never goes quiet. Skipped if anyone is talking; a real reply cuts it off straight away.
   */
  const fill = useCallback(
    async (kind: FillerKind, agent: AgentName) => {
      const list = fillers.current?.[kind];
      if (!list?.length || agent === "human_agent") return;
      const customerTalking =
        vad.current?.isSpeaking ||
        pendingTranscripts.current > 0 ||
        Boolean(held.current) ||
        (engine === "browser" && Boolean(browserRef.current.interim));
      if (stopSpeaking.current || customerTalking) return;

      const index = ((fillerTurn.current[kind] ?? -1) + 1) % list.length;
      fillerTurn.current[kind] = index;
      const text = list[index];
      const run = speakRun.current;
      lastSpoken.current = text;
      fillerPlaying.current = true;
      setFillerText(text);
      vad.current?.setGuarded(true);
      // Browser recognition would hear the filler, so it pauses for those two seconds.
      const resumeListening = engine === "browser" && browserRef.current.listening;
      if (engine === "browser") browserRef.current.abortListening();

      try {
        if (engine === "openai") {
          await new Promise<void>((resolve) => {
            const el = new Audio(api.fillerUrl(agent, kind, index));
            const done = () => {
              el.onended = el.onerror = null;
              resolve();
            };
            el.onended = done;
            el.onerror = done;
            stopSpeaking.current = () => {
              el.pause();
              el.removeAttribute("src");
              el.load();
              done();
            };
            el.play().catch(done);
          });
        } else {
          stopSpeaking.current = () => browserRef.current.cancelSpeech();
          await browserRef.current.speak(text, AGENTS[agent]);
        }
      } finally {
        fillerPlaying.current = false;
        setFillerText(null);
        // A real reply may have started meanwhile; leave its state alone.
        if (run === speakRun.current) {
          stopSpeaking.current = null;
          vad.current?.setGuarded(mode.current === "speaking");
          if (resumeListening) browserRef.current.listen();
        }
      }
    },
    [engine],
  );

  const listen = useCallback(() => {
    setError(null);
    if (engine === "openai") {
      if (!vad.current) return setError("Microphone access is blocked. Allow it in your browser, or type instead.");
      setMode("listening");
    } else {
      setMode("idle");
      browserRef.current.listen();
    }
  }, [engine]);

  /** Stop listening and send what was heard so far. */
  const stopListening = useCallback(() => {
    if (engine === "openai") {
      if (vad.current?.isSpeaking) vad.current.flush();
      else setMode("idle");
    } else browserRef.current.stopListening();
  }, [engine]);

  /** Stop listening and throw away what was heard (the customer typed instead). */
  const cancelListening = useCallback(() => {
    vad.current?.reset();
    clearTimeout(holdTimer.current);
    held.current = "";
    setHearing(false);
    if (mode.current === "listening") setMode("idle");
    browserRef.current.abortListening();
  }, []);

  const stopAll = useCallback(() => {
    stopSpeaking.current?.();
    cancelListening();
  }, [cancelListening]);

  useEffect(() => () => stopSpeaking.current?.(), []);

  return {
    fill,
    fillerText,
    canListen: engine === "openai" ? enabled : browser.canListen,
    speaking,
    listening: listening || browser.listening,
    hearing: hearing || (browser.listening && Boolean(browser.interim)),
    transcribing,
    interim: browser.interim,
    error: error ?? browser.micError ?? browser.voiceError,
    speak,
    interrupt,
    listen,
    stopListening,
    cancelListening,
    stopAll,
  };
}
