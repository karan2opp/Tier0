import { useEffect, useState } from "react";
import { AGENTS } from "../agents";
import { useSpeech } from "../hooks/useSpeech";
import type { VoiceEngine } from "../hooks/useVoice";
import { api, type AgentName } from "../api";
import type { DemoChoice } from "../demo";
import { Icon } from "./Icon";

const ROUTE: AgentName[] = ["front_desk", "troubleshoot", "status", "human_agent"];

export function Lobby({
  onStart,
  starting,
  voiceSupported,
  demo,
  onOpenGuide,
}: {
  onStart: (voice: boolean, engine: VoiceEngine) => void;
  starting: boolean;
  /** The demo account and issue picked in the guide, if any. */
  demo: DemoChoice | null;
  onOpenGuide: () => void;
  /** The browser has its own speech recognition and synthesis (Chrome, Edge). */
  voiceSupported: boolean;
}) {
  const micSupported = typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
  const [voice, setVoice] = useState(voiceSupported || micSupported);
  const [openaiVoice, setOpenaiVoice] = useState(false);
  /** OpenAI voice whenever the server can provide it; the browser's own voice otherwise. */
  const engine: VoiceEngine = openaiVoice ? "openai" : "browser";
  const speech = useSpeech(() => {});
  const [testing, setTesting] = useState(false);

  /** Plays a short sample in the voice the call will use. */
  const testVoice = async () => {
    setTesting(true);
    try {
      if (engine === "openai") {
        const sample = new Audio(api.fillerUrl("front_desk", "thinking", 0));
        await new Promise<void>((resolve) => {
          sample.onended = sample.onerror = () => resolve();
          sample.play().catch(() => resolve());
        });
      } else {
        speech.cancelSpeech();
        await speech.speak("Hi, this is Tier0 support. If you can hear me, your sound is working.", AGENTS.front_desk);
      }
    } finally {
      setTesting(false);
    }
  };
  const [health, setHealth] = useState<"checking" | "ok" | "db_down" | "offline">("checking");

  // Warn before the call starts, rather than letting it fail halfway through a demo.
  useEffect(() => {
    api
      .health()
      .then((h) => {
        setHealth(h.database === "up" ? "ok" : "db_down");
        setOpenaiVoice(Boolean(h.voice?.openai) && micSupported);
      })
      .catch(() => setHealth("offline"));
  }, [micSupported, voiceSupported]);

  const canUseVoice = voiceSupported || openaiVoice;

  return (
    <div className="lobby">
      <section className="lobby-hero">
        <span className="eyebrow">
          <span className="live-dot" /> AI support line · open now
        </span>
        <h1>
          Laptop trouble? Talk to Tier0.
        </h1>
        <p className="lede">
          No hold music, no phone number. Speak to our AI support desk right here in your browser. It checks your
          laptop safely, answers warranty and repair questions, and brings in a human when it should.
        </p>

        <div className="route">
          {ROUTE.map((agent, i) => (
            <div className="route-step" key={agent} style={{ ["--agent" as string]: AGENTS[agent].color }}>
              <span className="route-icon">
                <Icon name={AGENTS[agent].icon} size={16} />
              </span>
              <div>
                <strong>{AGENTS[agent].name}</strong>
                <small>{AGENTS[agent].role}</small>
              </div>
              {i < ROUTE.length - 1 && <Icon name="arrowRight" size={14} className="route-arrow" />}
            </div>
          ))}
        </div>
      </section>

      <section className="lobby-card">
        <h2>Before you start</h2>
        <ul className="checklist">
          <li>
            <Icon name="shield" size={16} />
            <span>
              <strong>You're verified once.</strong> Your phone number and the S/N under your laptop are checked by
              our server. The AI never sees them.
            </span>
          </li>
          <li>
            <Icon name="lock" size={16} />
            <span>
              <strong>Nothing runs without your OK.</strong> Every check is read-only and needs your approval first.
            </span>
          </li>
          <li>
            <Icon name="user" size={16} />
            <span>
              <strong>A human is one sentence away.</strong> Ask for a person anytime, and they get the full context.
            </span>
          </li>
        </ul>

        <label className={`toggle ${canUseVoice ? "" : "disabled"}`}>
          <input
            type="checkbox"
            checked={voice && canUseVoice}
            disabled={!canUseVoice}
            onChange={(e) => setVoice(e.target.checked)}
          />
          <span className="toggle-track" />
          <span>
            Use my voice
            <small>
              {canUseVoice ? (
                <>
                  Hold the <kbd>Space</kbd> button to speak, or press and hold the <Icon name="mic" size={12} className="inline-icon" />{" "}
                  mic button. Let go to send. Your browser will ask for the microphone.
                </>
              ) : (
                "Voice needs Chrome or Edge here; you can type instead"
              )}
            </small>
          </span>
        </label>

        {(engine === "openai" || speech.canSpeak) && (
          <div className="sound-test">
            <button type="button" className="btn btn-ghost" onClick={testVoice} disabled={testing}>
              <Icon name="volume" size={16} /> {testing ? "Playing..." : "Test speakers"}
            </button>
            <small>{speech.voiceError ?? "Check that you can hear the agent before you start."}</small>
          </div>
        )}

        {(health === "db_down" || health === "offline") && (
          <p className="health-warning" role="alert">
            {health === "offline"
              ? "The Tier0 server isn't reachable. Start it with npm run dev."
              : "The customer database is offline, so nobody can be verified. Start Docker and the database first."}
          </p>
        )}

        <div className="demo-choice">
          <div>
            <small>{demo ? "Your demo" : "New here?"}</small>
            <strong>{demo ? `${demo.account.name} · ${demo.issue.title}` : "Pick a demo account and an issue to try"}</strong>
            {demo && <span>"{demo.issue.say}"</span>}
          </div>
          <button type="button" className="btn btn-ghost" onClick={onOpenGuide}>
            {demo ? "Change" : "Show guide"}
          </button>
        </div>

        <button
          className="btn btn-primary btn-lg"
          onClick={() => onStart(voice && canUseVoice, engine)}
          disabled={starting || health === "offline"}
        >
          {starting ? <span className="spinner" /> : <Icon name="headset" size={18} />}
          {starting ? "Connecting..." : "Start support call"}
        </button>

      </section>
    </div>
  );
}
