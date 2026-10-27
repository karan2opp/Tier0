import { AGENTS } from "../agents";
import type { AgentName, ApprovalItem } from "../api";
import { ApprovalCard } from "./ApprovalCard";
import { Icon } from "./Icon";

export type Phase =
  | "connecting"
  | "transferring"
  | "speaking"
  | "listening"
  | "thinking"
  | "waiting"
  | "approval"
  | "with_human";

const PHASE_LABEL: Record<Phase, string> = {
  connecting: "Connecting",
  speaking: "Speaking",
  listening: "Listening",
  thinking: "Thinking",
  waiting: "Your turn",
  approval: "Waiting for your OK",
  with_human: "Transferring to a person",
  transferring: "Connecting",
};

export function AgentStage({
  agent,
  phase,
  caption,
  interim,
  note,
  hearing,
  approval,
  onAnswer,
  busy,
  canListen,
}: {
  agent: AgentName;
  phase: Phase;
  caption: string | null;
  interim: string;
  /** What the agent is saying while it works ("Let me check that for you."). */
  note?: string | null;
  /** The customer's voice is being picked up right now. */
  hearing: boolean;
  approval: { agent: AgentName; items: ApprovalItem[] } | null;
  onAnswer: (approve: boolean) => void;
  busy: boolean;
  canListen: boolean;
}) {
  const meta = AGENTS[agent];

  return (
    <section
      className="stage"
      data-phase={phase}
      data-hearing={hearing || undefined}
      style={{ ["--agent" as string]: meta.color }}
    >
      <div className="stage-glow" />

      <header className="stage-head">
        <span className="ai-badge">AI</span>
        <span className="stage-agent">{meta.name}</span>
        <span className={`phase-pill phase-${phase}`}>
          <span className="phase-dot" />
          {PHASE_LABEL[phase]}
        </span>
      </header>

      <div className="orb-wrap" aria-hidden="true">
        <div className="orb-ring r1" />
        <div className="orb-ring r2" />
        <div className="orb-ring r3" />
        <div className="orb">
          <Icon name={meta.icon} size={44} />
        </div>
        <div className="bars">
          {Array.from({ length: 5 }, (_, i) => (
            <span key={i} style={{ animationDelay: `${i * 0.12}s` }} />
          ))}
        </div>
      </div>

      <p className="stage-role">{meta.role}</p>

      <div className="caption" aria-live="polite">
        {phase === "listening" ? (
          <p className="caption-you">
            <span>You</span>
            {interim || "Listening... let go to send"}
          </p>
        ) : phase === "transferring" ? (
          <p className="caption-transfer">Connecting you to our {meta.name.toLowerCase()}...</p>
        ) : phase === "thinking" && (hearing || interim) ? (
          <p className="caption-you">
            <span>You, adding</span>
            {interim || "Hearing you..."}
          </p>
        ) : phase === "thinking" ? (
          <div className="caption-thinking">
            <span className="typing">
              <i />
              <i />
              <i />
            </span>
            {note ? <span className="caption-note">{note}</span> : canListen && <small>Thinking. Hold Space to add something.</small>}
          </div>
        ) : (
          caption && <p className="caption-agent">{caption}</p>
        )}
      </div>

      {approval && (
        <ApprovalCard agent={approval.agent} items={approval.items} onAnswer={onAnswer} busy={busy} canListen={canListen} />
      )}
    </section>
  );
}
