import { AGENTS } from "../agents";
import type { AgentName, ApprovalItem } from "../api";
import { AgentAvatar } from "./AgentAvatar";
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
  transferring: "Transferring",
  speaking: "Speaking",
  listening: "Listening",
  thinking: "Thinking",
  waiting: "Your turn",
  approval: "Waiting for your OK",
  with_human: "Human agent",
};

/**
 * The call stage: the agent's current line as text on the left, with a status pill under it, and the agent
 * itself on the right as a ringed planet in its own colour.
 */
export function AgentStage({
  agent,
  phase,
  caption,
  heard,
  interim,
  note,
  approval,
  onAnswer,
  busy,
  canListen,
}: {
  agent: AgentName;
  phase: Phase;
  caption: string | null;
  /** What the customer just said, shown while the agent works on it. */
  heard: string | null;
  interim: string;
  /** What the agent is saying while it works ("Let me check that for you."). */
  note?: string | null;
  approval: { agent: AgentName; items: ApprovalItem[] } | null;
  onAnswer: (approve: boolean) => void;
  busy: boolean;
  canListen: boolean;
}) {
  const meta = AGENTS[agent];

  const line =
    phase === "listening"
      ? interim || "Listening... let go to send"
      : phase === "transferring"
        ? `Connecting you to our ${meta.name.toLowerCase()}...`
        : phase === "thinking"
          ? note || caption
          : caption;

  return (
    <section className="stage" data-phase={phase} style={{ ["--agent" as string]: meta.color }}>
      <div className="stage-copy">
        {phase === "thinking" && heard && (
          <p className="stage-heard">
            <span>You</span>
            {heard}
          </p>
        )}
        <div className="speaker">
          <span className="speaker-icon">
            <Icon name={meta.icon} size={14} />
          </span>
          <span className="speaker-name">{meta.name}</span>
          <span className="ai-tag">{agent === "human_agent" ? "Line" : "AI"}</span>
        </div>
        <p className={`stage-line ${phase === "listening" ? "is-you" : ""}`} aria-live="polite" key={line ?? ""}>
          {line ?? ""}
        </p>
        <span className="status-pill">
          <span className="status-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {PHASE_LABEL[phase]}
          {phase === "thinking" && canListen && <small>Hold Space to add something</small>}
        </span>
      </div>

      <div className="agent-tile">
        <span className="tile-live">
          <span className="tile-live-dot" />
          {agent === "human_agent" ? "Human line" : "AI agent"}
        </span>
        <div className="avatar-wrap" key={agent}>
          <AgentAvatar agent={agent} />
        </div>
        <div className="tile-caption">
          <span className="tile-name">{meta.name}</span>
          <span className="tile-role">{meta.role}</span>
        </div>
      </div>

      {approval && (
        <ApprovalCard agent={approval.agent} items={approval.items} onAnswer={onAnswer} busy={busy} canListen={canListen} />
      )}
    </section>
  );
}
