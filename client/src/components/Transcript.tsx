import { useEffect, useRef } from "react";
import { AGENTS } from "../agents";
import type { Entry } from "../hooks/useConversation";
import { Icon } from "./Icon";

export function Transcript({ entries, busy }: { entries: Entry[]; busy: boolean }) {
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [entries.length, busy]);

  return (
    <div className="transcript">
      {entries.map((entry) => {
        switch (entry.kind) {
          case "customer":
            return (
              <div className="msg msg-you" key={entry.id}>
                <div className="bubble">{entry.text}</div>
                {entry.private && (
                  <span className="private-note">
                    <Icon name="lock" size={11} /> Phone and S/N hidden from the AI
                  </span>
                )}
              </div>
            );
          case "agent": {
            const meta = AGENTS[entry.agent];
            return (
              <div className="msg msg-agent" key={entry.id} style={{ ["--agent" as string]: meta.color }}>
                <span className="avatar">
                  <Icon name={meta.icon} size={14} />
                </span>
                <div>
                  <span className="msg-name">{meta.name}</span>
                  <div className={`bubble ${entry.blocked ? "bubble-blocked" : ""}`}>
                    {entry.blocked && (
                      <span className="blocked-tag">
                        <Icon name="shield" size={12} /> Guardrail
                      </span>
                    )}
                    {entry.text}
                  </div>
                  {entry.unspoken ? (
                    <span className="interrupted-note">Not read aloud: you were talking</span>
                  ) : (
                    entry.interrupted && <span className="interrupted-note">You interrupted here</span>
                  )}
                </div>
              </div>
            );
          }
          case "handoff":
            return (
              <div className="handoff" key={entry.id} style={{ ["--agent" as string]: AGENTS[entry.to].color }}>
                <span className="handoff-line" />
                <span className="handoff-pill">
                  <Icon name={AGENTS[entry.to].icon} size={12} />
                  Transferred to {AGENTS[entry.to].name}
                </span>
                {entry.reason && <small>{entry.reason}</small>}
              </div>
            );
          case "notice":
            return (
              <div className={`notice notice-${entry.tone}`} key={entry.id}>
                {entry.text}
              </div>
            );
        }
      })}
      {busy && (
        <div className="msg msg-agent pending">
          <span className="typing">
            <i />
            <i />
            <i />
          </span>
        </div>
      )}
      <div ref={end} />
    </div>
  );
}
