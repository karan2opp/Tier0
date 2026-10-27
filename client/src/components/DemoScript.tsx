import { useState } from "react";
import type { DemoChoice } from "../demo";
import { Icon } from "./Icon";

/** A small card during the call with the demo's details and what to say, so nothing has to be remembered. */
export function DemoScript({ demo }: { demo: DemoChoice }) {
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      setTimeout(() => setCopied((c) => (c === value ? null : c)), 1400);
    } catch {
      // Clipboard can be blocked; the value is visible anyway.
    }
  };

  return (
    <aside className={`demo-script ${open ? "open" : ""}`} aria-label="Demo script">
      <button className="demo-script-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>
          Demo · {demo.account.name} · {demo.issue.title}
        </span>
        <Icon name={open ? "x" : "arrowRight"} size={12} />
      </button>
      {open && (
        <div className="demo-script-body">
          <p className="demo-say">"{demo.issue.say}"</p>
          <div className="demo-creds">
            <button className="chip" onClick={() => copy(demo.account.phone)} title="Copy phone number">
              {demo.account.phone} <Icon name={copied === demo.account.phone ? "check" : "copy"} size={11} />
            </button>
            <button className="chip" onClick={() => copy(demo.account.serial)} title="Copy serial number">
              {demo.account.serial} <Icon name={copied === demo.account.serial ? "check" : "copy"} size={11} />
            </button>
          </div>
          <small>Give the phone number and S/N when the front desk asks.</small>
        </div>
      )}
    </aside>
  );
}
