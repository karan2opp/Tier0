import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { AgentName, FillerKind } from "../api";
import { useConversation, type Approval, type Delivery } from "../hooks/useConversation";
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
  greeting: Delivery | null;
  voice: boolean;
  engine: VoiceEngine;
  onEnd: () => void;
}) {
  /** The customer talks by holding Space or the mic button (hold-to-talk). */
  const holdToTalk = voice;
  const { state, busy, send, answer, reveal, revealApproval, markLine } = conversation;
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

  // Hold-to-talk with the Space bar, anywhere on the page except while typing in the message box.
  useEffect(() => {
    if (!holdToTalk) return;
    const typing = (target: EventTarget | null) =>
      target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || typing(e.target)) return;
      e.preventDefault(); // no page scroll, and no "click" on a focused button
      if (!e.repeat) voiceRef.current.pressTalk();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || typing(e.target)) return;
      e.preventDefault();
      voiceRef.current.releaseTalk();
    };
    // Switching windows mid-hold would otherwise leave the mic recording.
    const release = () => voiceRef.current.releaseTalk();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", release);
    };
  }, [holdToTalk]);

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
  const answerKind = (approve: boolean, approval: Approval | null): FillerKind =>
    approve && approval?.agent === "troubleshoot" ? "checking" : "thinking";

  /** An approval the server asked for whose card is not shown yet (the agent is still asking). */
  const pendingApproval = useRef<Approval | null>(null);

  /**
   * Plays a reply: its lines join the speaking queue behind anything still being said, and each line appears on
   * screen as it is spoken. The approval card comes after the agent has finished asking for it.
   */
  const play = useCallback(
    async (delivery: Delivery | null) => {
      if (!delivery || live.current.ended) return;
      const { reply, segments, approval } = delivery;
      if (approval) pendingApproval.current = approval;
      const showLine = (position: number) => {
        const segment = segments[position];
        reveal(segment.entries);
        setTransferring(false);
        setStageAgent(segment.message.agent);
        setCaption(segment.message.text);
      };

      if (live.current.speakAloud && segments.length > 0) {
        const skipped = new Set<number>();
        const result = await voiceRef.current.say(
          segments.map((segment) => segment.message),
          {
            onLine: (_line, position) => showLine(position),
            onSkip: (line, position) => {
              skipped.add(position);
              showLine(position);
              markLine(line, "unspoken");
            },
            onTransfer: (to) => {
              setStageAgent(to);
              setTransferring(true);
            },
          },
        );
        setTransferring(false);
        if (live.current.ended) return;
        if (result.outcome === "interrupted") {
          // The customer is already talking; the voice engine is capturing what they say.
          const position = segments.findIndex((segment) => segment.message === result.line);
          if (!skipped.has(position)) markLine(result.line, "interrupted");
          revealApproval(approval);
          pendingApproval.current = null;
          setStageAgent(reply.activeAgent);
          return;
        }
      } else {
        segments.forEach((_, position) => showLine(position));
      }

      revealApproval(approval);
      pendingApproval.current = null;
      setStageAgent(reply.activeAgent);
      if (reply.ended) {
        // The customer said goodbye: close the call after a moment, like hanging up.
        setTimeout(() => endCallRef.current(), END_AFTER_GOODBYE_MS);
        return;
      }
    },
    [reveal, revealApproval, markLine],
  );

  handleUtterance.current = async (text: string, interrupted: boolean) => {
    // Answers the approval even if its card is not on screen yet (the agent was still asking).
    const approval = live.current.state.approval ?? pendingApproval.current;
    if (approval) {
      if (YES.test(text)) return play(await withFillers(answerKind(true, approval), answer(true, approval)));
      if (NO.test(text)) return play(await withFillers("thinking", answer(false, approval)));
      setCaption('Please say "yes" or "no", or use the buttons.');
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
    voiceApi.cancelTalk();
    handleUtterance.current(text, wasSpeaking);
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
    play(await withFillers(answerKind(approve, state.approval), answer(approve)));
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
        : voiceApi.speaking
          ? "speaking"
          : busy || voiceApi.transcribing
            ? "thinking"
            : voiceApi.holding
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
            hearing={voiceApi.holding}
            approval={state.approval}
            onAnswer={respond}
            busy={busy}
            canListen={voiceApi.canTalk}
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
        {voice && !withHuman && (
          <p className="dock-hint">
            {voiceApi.holding ? (
              "Listening... let go to send"
            ) : (
              <>
                Hold <kbd>Space</kbd> or the mic button to talk{voiceApi.speaking ? " (the agent stops right away)" : ""}
              </>
            )}
          </p>
        )}
        <form className="composer" onSubmit={submit}>
          {holdToTalk && voiceApi.canTalk && (
            <button
              type="button"
              className={`mic-btn ${voiceApi.holding ? "on hearing" : ""}`}
              // Press and hold: pointer events work for mouse, touch and pen alike.
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                voiceApi.pressTalk();
              }}
              onPointerUp={() => voiceApi.releaseTalk()}
              onPointerCancel={() => voiceApi.releaseTalk()}
              onContextMenu={(e) => e.preventDefault()}
              onKeyDown={(e) => e.key === "Enter" && !e.repeat && voiceApi.pressTalk()}
              onKeyUp={(e) => e.key === "Enter" && voiceApi.releaseTalk()}
              disabled={withHuman}
              aria-label="Hold to talk"
              aria-pressed={voiceApi.holding}
              title="Hold to talk (or hold Space)"
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
                  : voiceApi.holding
                    ? "Listening... let go to send"
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
