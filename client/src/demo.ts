/** Seeded demo customers (see server/src/db/seed.ts) and short scripts that show off each agent. */

export interface DemoIssue {
  id: string;
  title: string;
  /** What to say once verified. */
  say: string;
  /** What it shows, in a few words. */
  shows: string;
}

export interface DemoAccount {
  id: string;
  name: string;
  laptop: string;
  phone: string;
  serial: string;
  /** Their situation in a few words. */
  status: string;
  issues: DemoIssue[];
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    id: "aarav",
    name: "Aarav",
    laptop: "Acer Aspire 7",
    phone: "9000000001",
    serial: "NHQN4SI00134501",
    status: "No repairs · warranty active",
    issues: [
      { id: "slow", title: "Slow laptop", say: "My laptop is really slow and lagging.", shows: "Live CPU and memory check, then a fix" },
      { id: "battery", title: "Battery drains fast", say: "My battery drains really fast.", shows: "Battery health check; human offered if worn" },
      { id: "wifi", title: "Wi-Fi keeps dropping", say: "My Wi-Fi keeps disconnecting.", shows: "Network and Wi-Fi signal check" },
      { id: "sound", title: "No sound", say: "I can't hear any sound from my laptop.", shows: "Sound device check" },
      { id: "storage", title: "Storage full", say: "It says my disk is almost full.", shows: "Free space check and cleanup steps" },
      { id: "warranty", title: "Warranty question", say: "What does my warranty cover?", shows: "Answered by the front desk, no transfer" },
    ],
  },
  {
    id: "ananya",
    name: "Ananya",
    laptop: "Lenovo IdeaPad Slim 5",
    phone: "9000000004",
    serial: "PF4KX9ZD",
    status: "Pickup booked for tomorrow",
    issues: [
      { id: "pickup", title: "Move my pickup", say: "When is my pickup? Can I move it to Friday?", shows: "Repairs team, time slots, Confirm card" },
    ],
  },
  {
    id: "vikram",
    name: "Vikram",
    laptop: "ASUS TUF F15",
    phone: "9000000005",
    serial: "R6NRCX03A114",
    status: "Repaired, ready for delivery",
    issues: [
      { id: "delivery", title: "Delivery date", say: "When will my laptop be delivered?", shows: "Delivery window, and moving it" },
    ],
  },
  {
    id: "rohan",
    name: "Rohan",
    laptop: "HP Pavilion 14",
    phone: "9000000003",
    serial: "5CD2419XKQ",
    status: "Repair waiting for a part",
    issues: [
      { id: "delay", title: "Repair delay", say: "Why is my repair taking so long?", shows: "Explains the delay from the repair notes" },
      { id: "human", title: "Ask for a person", say: "I want to talk to a real person.", shows: "Asks first, then the human line" },
    ],
  },
];

export interface DemoChoice {
  account: DemoAccount;
  issue: DemoIssue;
}

const STORAGE_KEY = "tier0.demo";
const SKIPPED_KEY = "tier0.guideSkipped";

/** The guide opens by itself on a first visit: until a demo is picked or the guide is skipped. */
export function shouldShowGuide(): boolean {
  try {
    return !localStorage.getItem(STORAGE_KEY) && !localStorage.getItem(SKIPPED_KEY);
  } catch {
    return true;
  }
}

export function markGuideSkipped() {
  try {
    localStorage.setItem(SKIPPED_KEY, "1");
  } catch {
    // Not remembered; the guide simply opens again next time.
  }
}

/** The demo picked last time (browser storage can be blocked, so this may be null). */
export function loadDemoChoice(): DemoChoice | null {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as { account: string; issue: string } | null;
    const account = DEMO_ACCOUNTS.find((a) => a.id === saved?.account);
    const issue = account?.issues.find((i) => i.id === saved?.issue);
    return account && issue ? { account, issue } : null;
  } catch {
    return null;
  }
}

export function saveDemoChoice(choice: DemoChoice | null) {
  try {
    if (choice) localStorage.setItem(STORAGE_KEY, JSON.stringify({ account: choice.account.id, issue: choice.issue.id }));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Not remembered; the guide simply opens again next time.
  }
}
