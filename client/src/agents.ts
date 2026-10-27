import type { AgentName } from "./api";
import type { IconName } from "./components/Icon";

export interface AgentMeta {
  name: string;
  role: string;
  icon: IconName;
  /** Accent colour for the orb, badges and transcript. */
  color: string;
  /** Voice settings so a transfer sounds like a different person picking up. */
  voice: { preferred: string[]; pitch: number; rate: number };
}

export const AGENTS: Record<AgentName, AgentMeta> = {
  front_desk: {
    name: "Front desk",
    role: "Verifies you and answers warranty questions",
    icon: "headset",
    color: "#8b93ff",
    voice: { preferred: ["Neerja", "Aria", "Jenny", "Heera", "Zira", "Samantha", "Google UK English Female"], pitch: 1.05, rate: 1.02 },
  },
  troubleshoot: {
    name: "Troubleshooting engineer",
    role: "Runs read-only Windows checks and suggests fixes",
    icon: "wrench",
    color: "#2dd4a7",
    voice: { preferred: ["Prabhat", "Guy", "Ryan", "Ravi", "David", "Mark", "Daniel", "Google UK English Male"], pitch: 0.95, rate: 1 },
  },
  status: {
    name: "Repairs team",
    role: "Repair status, pickups and deliveries",
    icon: "truck",
    color: "#f5b54a",
    voice: { preferred: ["Sonia", "Libby", "Hazel", "Zira", "Karen", "Moira", "Google US English"], pitch: 1.12, rate: 1.03 },
  },
  human_agent: {
    name: "Human agent",
    role: "A person takes over with everything so far",
    icon: "user",
    color: "#f472b6",
    voice: { preferred: ["Mark", "David", "Google US English"], pitch: 1, rate: 1 },
  },
};

/** "get_battery_health" -> "Battery health". */
export function toolLabel(tool: string): string {
  const words = tool.replace(/^(get|detect|check)_/, "").replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
