import type { AgentName } from "../api";
import voiceAgentFace from "../assets/voice-agent.webp";

/** Sound bars either side of the portrait, tallest in the middle (like a voice wave). */
const BAR_HEIGHTS = [0.25, 0.55, 1, 0.55, 0.25];

/**
 * The voice agent: a portrait inside a neon ring in the agent's own colour (from the --agent CSS variable), with
 * sound bars either side. The stage's phase animates it: bars and ripples while speaking, a spinning orbit while
 * thinking, a red ring while the customer holds to talk. The human line is drawn as a person instead.
 */
export function AgentAvatar({ agent }: { agent: AgentName }) {
  if (agent === "human_agent") return <HumanAvatar />;

  const bars = (side: "left" | "right") => (
    <div className={`va-bars ${side}`} aria-hidden="true">
      {BAR_HEIGHTS.map((height, i) => (
        <span key={i} className={`va-bar b${i}`} style={{ ["--h" as string]: height }} />
      ))}
    </div>
  );

  return (
    <div className="voice-avatar">
      {bars("left")}
      <div className="va-core">
        <span className="va-ripple r1" aria-hidden="true" />
        <span className="va-ripple r2" aria-hidden="true" />
        <span className="va-orbit" aria-hidden="true" />
        <div className="va-ring">
          <img src={voiceAgentFace} alt="" draggable={false} />
        </div>
      </div>
      {bars("right")}
    </div>
  );
}

function HumanAvatar() {
  return (
    <svg className="avatar-svg" viewBox="0 0 200 200" aria-hidden="true">
      <circle className="av-orbit" cx="100" cy="100" r="92" />
      <circle className="av-head" cx="100" cy="82" r="28" />
      <path className="av-head" d="M52 160 C56 124 144 124 148 160 Z" />
      <path className="av-stroke" d="M64 84 C64 48 136 48 136 84" fill="none" />
      <rect className="av-fill" x="58" y="78" width="10" height="20" rx="4" />
      <rect className="av-fill" x="132" y="78" width="10" height="20" rx="4" />
    </svg>
  );
}
