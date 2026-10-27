import { AGENTS, toolLabel } from "../agents";
import type { AgentName } from "../api";
import type { ConversationState } from "../hooks/useConversation";
import { Icon } from "./Icon";

export function EndScreen({ state, onRestart, onHome }: { state: ConversationState; onRestart: () => void; onHome: () => void }) {
  const agents = (["front_desk", ...state.handoffs.map((h) => h.to)] as AgentName[]).filter(
    (agent, i, all) => all.indexOf(agent) === i,
  );
  const duration = state.startedAt ? Math.max(1, Math.round((Date.now() - state.startedAt) / 1000)) : 0;
  const checks = state.toolsRun.filter((t) => t.agent === "troubleshoot");
  const resolved = state.diagnosis?.case?.status === "resolved";

  return (
    <div className="end">
      <div className="end-card">
        <span className="end-icon">
          <Icon name={state.escalation ? "user" : "check"} size={28} />
        </span>
        <h1>{state.escalation ? "Passed to a human agent" : resolved ? "Problem solved" : "Call ended"}</h1>
        <p className="lede">
          {state.escalation
            ? `${state.escalation.reason}. They have the full case, so you won't have to repeat yourself.`
            : "Thanks for calling Tier0 support."}
        </p>

        <dl className="stats">
          <div>
            <dt>Duration</dt>
            <dd>
              {Math.floor(duration / 60)}m {duration % 60}s
            </dd>
          </div>
          <div>
            <dt>Agents</dt>
            <dd>{agents.length}</dd>
          </div>
          <div>
            <dt>Checks run</dt>
            <dd>{checks.length}</dd>
          </div>
          <div>
            <dt>Verified</dt>
            <dd>{state.verified ? "Yes" : "No"}</dd>
          </div>
        </dl>

        <div className="chips center">
          {agents.map((agent) => (
            <span className="chip chip-static" key={agent} style={{ ["--agent" as string]: AGENTS[agent].color }}>
              <Icon name={AGENTS[agent].icon} size={12} /> {AGENTS[agent].name}
            </span>
          ))}
          {checks.map((c, i) => (
            <span className="chip chip-static" key={`c${i}`}>
              <Icon name="activity" size={12} /> {toolLabel(c.tool)}
            </span>
          ))}
        </div>

        <div className="end-actions">
          <button className="btn btn-ghost" onClick={onHome}>
            Back to home
          </button>
          <button className="btn btn-primary" onClick={onRestart}>
            <Icon name="refresh" size={16} /> Start a new call
          </button>
        </div>
      </div>
    </div>
  );
}
