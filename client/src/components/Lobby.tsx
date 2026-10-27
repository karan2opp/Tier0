import { useEffect, useState } from "react";
import { AGENTS } from "../agents";
import { useSpeech } from "../hooks/useSpeech";
import type { VoiceEngine } from "../hooks/useVoice";
import { api, type AgentName } from "../api";
import { Icon } from "./Icon";

/** Seeded demo customers, so anyone can try a full call. */
const DEMO_ACCOUNTS = [
  { name: "Aarav", phone: "9000000001", serial: "NHQN4SI00134501", try: "Warranty, or \"my laptop is slow\"" },
  { name: "Ananya", phone: "9000000004", serial: "PF4KX9ZD", try: "\"Can I move my pickup?\"" },
  { name: "Vikram", phone: "9000000005", serial: "R6NRCX03A114", try: "\"When will my laptop be delivered?\"" },
  { name: "Rohan", phone: "9000000003", serial: "5CD2419XKQ", try: "\"Why is my repair taking so long?\"" },
];

const ROUTE: AgentName[] = ["front_desk", "troubleshoot", "status", "human_agent"];

export function Lobby({
  onStart,
  starting,
  voiceSupported,
}: {
  onStart: (voice: boolean, engine: VoiceEngine) => void;
  starting: boolean;
  /** The browser has its own speech recognition and synthesis (Chrome, Edge). */
  voiceSupported: boolean;
}) {
  const micSupported = typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
  const [voice, setVoice] = useState(voiceSupported || micSupported);
  const [engine, setEngine] = useState<VoiceEngine>("browser");
  const [openaiVoice, setOpenaiVoice] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const speech = useSpeech(() => {});
  const testVoice = () => {
    speech.cancelSpeech();
    speech.speak("Hi, this is Tier0 support. If you can hear me, your sound is working.", AGENTS.front_desk);
  };
  const [health, setHealth] = useState<"checking" | "ok" | "db_down" | "offline">("checking");

  // Warn before the call starts, rather than letting it fail halfway through a demo.
  useEffect(() => {
    api
      .health()
      .then((h) => {
        setHealth(h.database === "up" ? "ok" : "db_down");
        const available = Boolean(h.voice?.openai) && micSupported;
        setOpenaiVoice(available);
        // Without the browser's own speech, OpenAI voice is the only way to talk.
        if (!voiceSupported && available) setEngine("openai");
      })
      .catch(() => setHealth("offline"));
  }, [micSupported, voiceSupported]);

  const canUseVoice = voiceSupported || openaiVoice;

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
    <div className="lobby">
      <section className="lobby-hero">
        <span className="eyebrow">
          <span className="live-dot" /> AI support line · open now
        </span>
        <h1>
          Laptop trouble? <span className="grad">Talk to Tier0.</span>
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
              {canUseVoice
                ? "Hold Space or the mic button to talk; the agent stops the moment you do. Your browser will ask for the microphone."
                : "Voice needs Chrome or Edge here; you can type instead"}
            </small>
          </span>
        </label>

        {voice && canUseVoice && (
          <div className="engine-picker" role="radiogroup" aria-label="Voice">
            <button
              type="button"
              role="radio"
              aria-checked={engine === "browser"}
              className="engine-option"
              disabled={!voiceSupported}
              onClick={() => setEngine("browser")}
            >
              <strong>Browser voice</strong>
              <small>{voiceSupported ? "Free · built into Chrome and Edge" : "Not available in this browser"}</small>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={engine === "openai"}
              className="engine-option"
              disabled={!openaiVoice}
              onClick={() => setEngine("openai")}
            >
              <strong>OpenAI voice</strong>
              <small>{openaiVoice ? "Natural voices · about 3¢ per call" : "Needs an OpenAI key on the server"}</small>
            </button>
          </div>
        )}


        {speech.canSpeak && (
          <div className="sound-test">
            <button type="button" className="btn btn-ghost" onClick={testVoice} disabled={speech.speaking}>
              <Icon name="volume" size={16} /> {speech.speaking ? "Playing..." : "Test speakers"}
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

        <button
          className="btn btn-primary btn-lg"
          onClick={() => onStart(voice && canUseVoice, engine)}
          disabled={starting || health === "offline"}
        >
          {starting ? <span className="spinner" /> : <Icon name="headset" size={18} />}
          {starting ? "Connecting..." : "Start support call"}
        </button>

        <details className="demo">
          <summary>Demo accounts</summary>
          <p>Say or type the phone number and S/N when the front desk asks.</p>
          <div className="demo-list">
            {DEMO_ACCOUNTS.map((account) => (
              <div className="demo-row" key={account.phone}>
                <strong>{account.name}</strong>
                <button className="chip" onClick={() => copy(account.phone)} title="Copy phone number">
                  {account.phone} <Icon name={copied === account.phone ? "check" : "copy"} size={12} />
                </button>
                <button className="chip" onClick={() => copy(account.serial)} title="Copy serial number">
                  {account.serial} <Icon name={copied === account.serial ? "check" : "copy"} size={12} />
                </button>
                <small>{account.try}</small>
              </div>
            ))}
          </div>
        </details>
      </section>
    </div>
  );
}
