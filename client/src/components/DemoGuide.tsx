import { useEffect, useState } from "react";
import { DEMO_ACCOUNTS, type DemoChoice } from "../demo";
import { Icon } from "./Icon";

/**
 * The welcome guide shown on a first visit: how a call works in three steps, then pick a demo account and an
 * issue to try. The choice is shown again during the call, so nobody has to remember the details.
 */
export function DemoGuide({
  initial,
  onChoose,
  onSkip,
}: {
  initial: DemoChoice | null;
  onChoose: (choice: DemoChoice) => void;
  onSkip: () => void;
}) {
  const [accountId, setAccountId] = useState(initial?.account.id ?? DEMO_ACCOUNTS[0].id);
  const account = DEMO_ACCOUNTS.find((a) => a.id === accountId) ?? DEMO_ACCOUNTS[0];
  const [issueId, setIssueId] = useState(initial?.issue.id ?? account.issues[0].id);
  const issue = account.issues.find((i) => i.id === issueId) ?? account.issues[0];

  const pickAccount = (id: string) => {
    setAccountId(id);
    setIssueId(DEMO_ACCOUNTS.find((a) => a.id === id)!.issues[0].id);
  };

  useEffect(() => {
    const close = (e: KeyboardEvent) => e.key === "Escape" && onSkip();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onSkip]);

  return (
    <div className="guide-backdrop" role="presentation">
      <div className="guide" role="dialog" aria-modal="true" aria-labelledby="guide-title">
        <header className="guide-head">
          <div>
            <h2 id="guide-title">Welcome to Tier0</h2>
            <p>An AI support desk you can talk to. Here's how to try it.</p>
          </div>
          <button className="ctrl ctrl-sm" onClick={onSkip} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </header>

        <ol className="guide-steps">
          <li>
            <span className="step-num">1</span>
            <div>
              <strong>Pick a demo below</strong>
              <small>A customer and a problem to try.</small>
            </div>
          </li>
          <li>
            <span className="step-num">2</span>
            <div>
              <strong>
                Hold <kbd>Space</kbd> to talk
              </strong>
              <small>Or hold the mic button. Let go to send.</small>
            </div>
          </li>
          <li>
            <span className="step-num">3</span>
            <div>
              <strong>Give the phone and S/N</strong>
              <small>When asked. Then allow checks when it asks.</small>
            </div>
          </li>
        </ol>

        <h3 className="guide-label">Demo account</h3>
        <div className="account-grid" role="radiogroup" aria-label="Demo account">
          {DEMO_ACCOUNTS.map((a) => (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={a.id === account.id}
              className="account-card"
              onClick={() => pickAccount(a.id)}
            >
              <strong>{a.name}</strong>
              <small>{a.laptop}</small>
              <span className="account-status">{a.status}</span>
            </button>
          ))}
        </div>

        <h3 className="guide-label">Issue to try</h3>
        <div className="issue-list" role="radiogroup" aria-label="Issue to try">
          {account.issues.map((i) => (
            <button
              key={i.id}
              type="button"
              role="radio"
              aria-checked={i.id === issue.id}
              className="issue-row"
              onClick={() => setIssueId(i.id)}
            >
              <span className="issue-radio" aria-hidden="true" />
              <span className="issue-text">
                <strong>{i.title}</strong>
                <small>{i.shows}</small>
              </span>
            </button>
          ))}
        </div>

        <div className="guide-script">
          <span>You'll say</span>
          <p>"{issue.say}"</p>
          <small>
            Then, when asked: phone <b>{account.phone}</b> · S/N <b>{account.serial}</b>
          </small>
        </div>

        <footer className="guide-actions">
          <button className="btn btn-ghost" onClick={onSkip}>
            Skip
          </button>
          <button className="btn btn-primary" onClick={() => onChoose({ account, issue })}>
            <Icon name="check" size={16} /> Use this demo
          </button>
        </footer>
      </div>
    </div>
  );
}
