import { toolLabel } from "../agents";
import { isCheckApproval, type AgentName, type ApprovalItem } from "../api";
import { Icon } from "./Icon";

export function ApprovalCard({
  agent,
  items,
  onAnswer,
  busy,
  canListen,
}: {
  agent: AgentName;
  items: ApprovalItem[];
  onAnswer: (approve: boolean) => void;
  busy: boolean;
  canListen: boolean;
}) {
  const checks = items.filter(isCheckApproval);
  const isCheck = agent === "troubleshoot";

  return (
    <div className="approval" role="dialog" aria-label={isCheck ? "Approve a read-only check" : "Confirm a change"}>
      <div className="approval-head">
        <span className="approval-icon">
          <Icon name={isCheck ? "shield" : "truck"} size={18} />
        </span>
        <div>
          <strong>{isCheck ? "Allow a read-only check?" : "Confirm this change?"}</strong>
          <small>{isCheck ? "It only reads information and changes nothing on your laptop." : "Nothing is saved until you confirm."}</small>
        </div>
      </div>

      {isCheck ? (
        <ul className="approval-list">
          {checks.map((check) => (
            <li key={check.callId}>
              <span className="tag">Read-only</span>
              <div>
                <strong>{check.title || toolLabel(check.tool)}</strong>
                {check.selfCheck && <small>Or check it yourself: {check.selfCheck}</small>}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="approval-list">
          {items.map((item) => (
            <li key={item.callId}>
              <span className="tag tag-warn">Change</span>
              <div>
                <strong>{"description" in item ? capitalize(item.description) : "Update your booking"}</strong>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="approval-actions">
        <button className="btn btn-ghost" onClick={() => onAnswer(false)} disabled={busy}>
          <Icon name="x" size={16} /> {isCheck ? "No thanks" : "Cancel"}
        </button>
        <button className="btn btn-primary" onClick={() => onAnswer(true)} disabled={busy}>
          <Icon name="check" size={16} /> {isCheck ? "Allow check" : "Confirm"}
        </button>
      </div>
      {canListen && <p className="approval-hint">Or hold Space and say "yes" or "no".</p>}
    </div>
  );
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
