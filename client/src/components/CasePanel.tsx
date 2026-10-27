import { AGENTS, toolLabel } from "../agents";
import type { ConversationState } from "../hooks/useConversation";
import { Icon } from "./Icon";

export function CasePanel({ state }: { state: ConversationState }) {
  const { customer, verified, handoffs, toolsRun, diagnosis, escalation } = state;
  const checks = toolsRun.filter((t) => t.agent === "troubleshoot");
  const confidence = diagnosis?.confidence ?? 0;

  return (
    <div className="case">
      <article className="case-card">
        <h3>Identity</h3>
        {verified && customer ? (
          <div className="identity ok">
            <span className="identity-icon">
              <Icon name="shield" size={16} />
            </span>
            <div>
              <strong>Verified · {customer.firstName}</strong>
              {customer.laptop && <small>{customer.laptop}</small>}
            </div>
          </div>
        ) : (
          <div className="identity">
            <span className="identity-icon">
              <Icon name="lock" size={16} />
            </span>
            <div>
              <strong>Not verified yet</strong>
              <small>Registered phone number + laptop S/N, checked on the server</small>
            </div>
          </div>
        )}
      </article>

      <article className="case-card">
        <h3>Call route</h3>
        <ol className="timeline">
          <li style={{ ["--agent" as string]: AGENTS.front_desk.color }}>
            <span className="tl-dot" />
            <div>
              <strong>{AGENTS.front_desk.name}</strong>
              <small>Answered the call</small>
            </div>
          </li>
          {handoffs.map((h, i) => (
            <li key={i} style={{ ["--agent" as string]: AGENTS[h.to].color }}>
              <span className="tl-dot" />
              <div>
                <strong>{AGENTS[h.to].name}</strong>
                <small>{h.reason || `From ${AGENTS[h.from].name}`}</small>
              </div>
            </li>
          ))}
        </ol>
      </article>

      {checks.length > 0 && (
        <article className="case-card">
          <h3>Checks run on this laptop</h3>
          <div className="chips">
            {checks.map((c, i) => (
              <span className="chip chip-static" key={i}>
                <Icon name="activity" size={12} /> {toolLabel(c.tool)}
              </span>
            ))}
          </div>
        </article>
      )}

      {diagnosis && (diagnosis.likelyCause || diagnosis.findings.length > 0) && (
        <article className="case-card">
          <h3>Diagnosis</h3>
          {diagnosis.likelyCause && <p className="cause">{diagnosis.likelyCause}</p>}
          <div className="confidence">
            <div className="confidence-bar">
              <span style={{ width: `${confidence}%` }} />
            </div>
            <small>{confidence}% confidence</small>
          </div>
          {diagnosis.findings.length > 0 && (
            <ul className="findings">
              {diagnosis.findings.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          )}
          {diagnosis.fixes.map((fix, i) => (
            <div className="fix" key={i}>
              <div className="fix-head">
                <strong>{fix.title}</strong>
                <span className={`tag ${fix.doneBy === "technician" ? "tag-warn" : ""}`}>
                  {fix.doneBy === "technician" ? "Technician" : "You can do this"}
                </span>
              </div>
              <ol>
                {fix.steps.map((step, j) => (
                  <li key={j}>{step}</li>
                ))}
              </ol>
            </div>
          ))}
        </article>
      )}

      {escalation && (
        <article className="case-card escalation">
          <h3>Handed to a human</h3>
          <p>{escalation.reason}</p>
          {escalation.caseSummary && escalation.caseSummary.hardwareIssues.length > 0 && (
            <ul className="findings">
              {escalation.caseSummary.hardwareIssues.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          )}
          <small>The engineer sees this case, the checks and the full transcript.</small>
        </article>
      )}
    </div>
  );
}
