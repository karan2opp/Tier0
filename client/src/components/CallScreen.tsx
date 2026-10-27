import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { AgentName, ConversationReply, FillerKind } from "../api";
import { useConversation } from "../hooks/useConversation";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useVoice, type VoiceEngine } from "../hooks/useVoice";
import { AgentStage, type Phase } from "./AgentStage";
import { CasePanel } from "./CasePanel";
import { Icon } from "./Icon";
import { Transcript } from "./Transcript";

const YES = /^(yes|yeah|yep|yup|sure|ok|okay|go ahead|allow|confirm|please do|do it|haan|ha)\b/i;
const NO = /^(no|nope|nah|don'?t|do not|cancel|deny|not now|stop)\b/i;
/** Looks like a phone number or serial number: the front desk will be verifying. */
const CREDENTIAL_LIKE = /\d[\d\s-]{8,}\d|\b(?=[a-z0-9]*\d)(?=[a-z0-9]*[a-z])[a-z0-9]{8,}\b/i;
/** How long a pause before the agent says "let me check that" (quick answers arrive before this). */
const FILLER_DELAY_MS = 700;
/** When an answer is taking unusually long, one more "still on it". */
const STILL_DELAY_MS = 7000;
/** A moment after the goodbye before the call screen closes. */
const END_AFTER_GOODBYE_MS = 1800;

type Conversation = ReturnType<typeof useConversation>;

export function CallScreen({
  conversation,
  greeting,
  voice,
  engine,
  onEnd,
}: {
  conversation: Conversation;
  greeting: ConversationReply | null;
  voice: boolean;
  engine: VoiceEngine;
  onEnd: () => void;
}) {
  const { state, busy, send, answer, markInterrupted } = conversation;
  const wide = useMediaQuery("(min-width: 1200px)");

  const [speakAloud, setSpeakAloud] = useState(voice);
  const [stageAgent, setStageAgent] = useState<AgentName>("front_desk");
  const [caption, setCaption] = useState<string | null>(null);
  /** Set during the short pause while the call is put through to another agent. */
  const [transferring, setTransferring] = useState(false);
  const [tab, setTab] = useState<"transcript" | "case">("transcript");
  const [draft, setDraft] = useState("");
  const [elapsed, setElapsed] = useState(0);

  // Latest values for callbacks fired by the voice engine.
  const live = useRef({ state, speakAloud, ended: false });
  live.current = { ...live.current, state, speakAloud };

  const handleUtterance = useRef<(text: string, interrupted: boolean) => void>(() => {});
  const voiceApi = useVoice({
    engine,
    enabled: voice,
    sessionId: state.sessionId,
    onUtterance: (text, interrupted) => handleUtterance.current(text, interrupted),
  });
  const voiceRef = useRef(voiceApi);
  voiceRef.current = voiceApi;
  const endCallRef = useRef<() => void>(() => {});

  const fillerTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const pendingRequests = useRef(0);
  const clearFillers = () => {
    fillerTimers.current.forEach(clearTimeout);
    fillerTimers.current = [];
  };

  /** Waits for an answer; if it takes a moment, the agent says a short filler so the line never goes quiet. */
  const withFillers = async <T,>(kind: FillerKind, request: Promise<T>): Promise<T> => {
    clearFillers();
    if (voice && live.current.speakAloud) {
      const agent = () => live.current.state.activeAgent;
      fillerTimers.current = [
        setTimeout(() => voiceRef.current.fill(kind, agent()), kind === "checking" ? 300 : FILLER_DELAY_MS),
        setTimeout(() => voiceRef.current.fill("still", agent()), STILL_DELAY_MS),
      ];
    }
    pendingRequests.current += 1;
    try {
      return await request;
    } finally {
      pendingRequests.current -= 1;
      if (pendingRequests.current === 0) clearFillers();
    }
  };

  /** "checking" while an allowed diagnostic runs on the laptop, otherwise "thinking". */
  const answerKind = (approve: boolean): FillerKind =>
    approve && live.current.state.approval?.agent === "troubleshoot" ? "checking" : "thinking";

  /** Plays a reply aloud (or just shows it when muted), then hands the turn back to the customer. */
  const play = useCallback(
    async (reply: ConversationReply | null) => {
      if (!reply || live.current.ended) return;
      const show = (agent: AgentName, text: string) => {
        setTransferring(false);
        setStageAgent(agent);
        setCaption(text);
      };

      if (live.current.speakAloud && reply.messages.length > 0) {
        const result = await voiceRef.current.speak(
          reply.messages,
          (line) => show(line.agent, line.text),
          (to) => {
            setStageAgent(to);
            setTransferring(true);
          },
        );
        setTransferring(false);
        if (live.current.ended) return;
        if (result.outcome === "interrupted") {
          // The customer is already talking; the voice engine is capturing what they say.
          markInterrupted(result.line.index, result.line.text);
          setStageAgent(reply.activeAgent);
          return;
        }
      } else {
        const last = reply.messages[reply.messages.length - 1];
        if (last) show(last.agent, last.text);
      }

      setStageAgent(reply.activeAgent);
      if (reply.ended) {
        // The customer said goodbye: close the call after a moment, like hanging up.
        setTimeout(() => endCallRef.current(), END_AFTER_GOODBYE_MS);
        return;
      }
      if (voice && reply.status !== "with_human") voiceRef.current.listen();
    },
    [markInterrupted, voice],
  );

  handleUtterance.current = async (text: string, interrupted: boolean) => {
    if (live.current.state.approval) {
      if (YES.test(text)) return play(await withFillers(answerKind(true), answer(true)));
      if (NO.test(text)) return play(await withFillers("thinking", answer(false)));
      setCaption('Please say "yes" or "no", or use the buttons.');
      if (voice) voiceRef.current.listen();
      return;
    }
    play(await withFillers(CREDENTIAL_LIKE.test(text) ? "verifying" : "thinking", send(text, interrupted)));
  };

  // Greet once (StrictMode mounts twice in development; the ref keeps it to one).
  const greeted = useRef(false);
  useEffect(() => {
    if (greeted.current || !greeting) return;
    greeted.current = true;
    play(greeting);
  }, [greeting, play]);

  useEffect(() => {
    if (!state.startedAt) return;
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - state.startedAt!) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [state.startedAt]);

  // Reset on mount too: StrictMode unmounts and remounts once in development, which must not end the call.
  useEffect(() => {
    live.current.ended = false;
    return () => {
      live.current.ended = true;
    };
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    const wasSpeaking = voiceApi.speaking;
    if (wasSpeaking) voiceApi.interrupt();
    voiceApi.cancelListening();
    handleUtterance.current(text, wasSpeaking);
  };

  const toggleMic = () => {
    if (voiceApi.speaking) {
      // Tap to interrupt: stop the agent and listen straight away.
      voiceApi.interrupt();
      return voiceApi.listen();
    }
    if (voiceApi.listening) return voiceApi.stopListening();
    voiceApi.listen();
  };

  const toggleSpeakAloud = () => {
    if (speakAloud) {
      voiceApi.interrupt();
      setSpeakAloud(false);
      return;
    }
    setSpeakAloud(true);
    live.current.speakAloud = true;
  };

  const respond = async (approve: boolean) => {
    voiceApi.stopAll();
    play(await withFillers(answerKind(approve), answer(approve)));
  };

  const endCall = () => {
    live.current.ended = true;
    clearFillers();
    voiceApi.stopAll();
    onEnd();
  };
  endCallRef.current = endCall;

  const withHuman = state.status === "with_human";
  const phase: Phase = !state.sessionId
    ? "connecting"
    : withHuman && !voiceApi.speaking
      ? "with_human"
      : transferring
        ? "transferring"
        : busy || voiceApi.transcribing
          ? "thinking"
        : voiceApi.speaking
          ? "speaking"
          : voiceApi.listening
            ? "listening"
            : state.approval
              ? "approval"
              : "waiting";

  return (
    <div className="call">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">T0</span>
          <span className="brand-name">Tier0</span>
          <span className="brand-sub">Laptop support call</span>
        </div>
        <div className="topbar-right">
          {voice && <span className="engine-badge hide-sm">{engine === "openai" ? "OpenAI voice" : "Browser voice"}</span>}
          <span className="timer">
            <span className="rec-dot" />
            {formatTime(elapsed)}
          </span>
          <button
            className="icon-btn"
            onClick={toggleSpeakAloud}
            aria-label={speakAloud ? "Mute agent voice" : "Read replies aloud"}
            title={speakAloud ? "Mute agent voice" : "Read replies aloud"}
          >
            <Icon name={speakAloud ? "volume" : "volumeOff"} />
          </button>
          <button className="btn btn-danger" onClick={endCall}>
            <Icon name="phoneOff" size={16} />
            <span className="hide-sm">End call</span>
          </button>
        </div>
      </header>

      <main className="call-grid">
        <div className="stage-col">
          <AgentStage
            agent={withHuman && !voiceApi.speaking ? "human_agent" : stageAgent}
            phase={phase}
            caption={caption}
            interim={voiceApi.interim}
            note={voiceApi.fillerText}
            hearing={voiceApi.hearing}
            approval={state.approval}
            onAnswer={respond}
            busy={busy}
            canListen={voice && voiceApi.canListen}
          />
          {wide && (
            <div className="case-wide">
              <CasePanel state={state} />
            </div>
          )}
        </div>

        <aside className="side">
          {!wide && (
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={tab === "transcript"} onClick={() => setTab("transcript")}>
                Transcript
              </button>
              <button role="tab" aria-selected={tab === "case"} onClick={() => setTab("case")}>
                Case {state.verified && <span className="tab-dot" />}
              </button>
            </div>
          )}
          {wide && <div className="side-title">Transcript</div>}
          <div className="side-body">
            {wide || tab === "transcript" ? <Transcript entries={state.entries} busy={busy} /> : <CasePanel state={state} />}
          </div>
        </aside>
      </main>

      <footer className="dock">
        {voiceApi.error && <p className="dock-error">{voiceApi.error}</p>}
        {voice && voiceApi.speaking && <p className="dock-hint">Start talking anytime to interrupt</p>}
        <form className="composer" onSubmit={submit}>
          {voice && voiceApi.canListen && (
            <button
              type="button"
              className={`mic-btn ${voiceApi.listening ? "on" : ""} ${voiceApi.hearing ? "hearing" : ""}`}
              onClick={toggleMic}
              disabled={withHuman}
              aria-label={voiceApi.speaking ? "Interrupt and talk" : voiceApi.listening ? "Stop listening" : "Talk"}
              title={voiceApi.speaking ? "Interrupt and talk" : voiceApi.listening ? "Stop listening" : "Tap to talk"}
            >
              <Icon name="mic" size={20} />
            </button>
          )}
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              withHuman
                ? "A human agent will join shortly..."
                : state.approval
                  ? 'Type "yes" or "no", or use the buttons above'
                  : busy
                    ? "Thinking... you can keep talking or typing"
                    : voiceApi.listening
                      ? "Listening... or type here"
                    : "Type your message"
            }
            maxLength={2000}
            aria-label="Message"
          />
          <button type="submit" className="send-btn" disabled={!draft.trim()} aria-label="Send">
            <Icon name="send" size={18} />
          </button>
        </form>
      </footer>
    </div>
  );
}

const formatTime = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
