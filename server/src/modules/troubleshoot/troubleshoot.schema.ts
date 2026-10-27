import { z } from "zod";

export const runToolSchema = z.record(z.string(), z.unknown()).default({});

/* ---------- The agent's structured decision (enforced on every turn) ---------- */

export const nextActions = ["ask_question", "offer_check", "try_fix", "resolved", "escalate_to_human"] as const;
export type NextAction = (typeof nextActions)[number];

export const fixSchema = z.object({
  title: z.string().describe("Short name of the fix"),
  steps: z.array(z.string()).describe("Concrete, safe steps in order"),
  doneBy: z.enum(["customer", "technician"]).describe("customer = they can do it now; technician = needs a repair"),
});

export const troubleshootDecisionSchema = z.object({
  reply: z.string().describe("What to say to the customer now, in plain spoken sentences, no markdown"),
  findings: z.array(z.string()).describe("Facts learned so far from checks or the customer, with numbers"),
  likelyCause: z.string().nullable().describe("Your current best explanation, or null if unknown yet"),
  confidence: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe("How sure you are about likelyCause, 0-100, following the confidence guide"),
  fixes: z.array(fixSchema).describe("Fixes suggested in this reply; empty if none yet"),
  nextAction: z.enum(nextActions).describe(
    "ask_question: need info from the customer. offer_check: offering a self-check or to run a check. " +
      "try_fix: gave fix steps and waiting to hear if it worked. resolved: customer confirmed it is fixed. " +
      "escalate_to_human: needs a repair, data at risk, out of ideas, or the customer wants a person.",
  ),
  escalationReason: z.string().nullable().describe("Why a human is needed, only when nextAction is escalate_to_human"),
});

export type TroubleshootDecision = z.infer<typeof troubleshootDecisionSchema>;

/* ---------- Case state tracked by the server across the conversation ---------- */

export type CaseStatus = "investigating" | "fixing" | "resolved" | "escalated";

export interface CaseState {
  status: CaseStatus;
  /** Whether the agent has offered self-checks / running a check at least once. */
  checkOffered: boolean;
  fixAttempts: number;
  checksRun: number;
  /** Checks run since the customer's last message. */
  checksThisTurn: number;
  /** Set when the server denied a check request; hides the tools until the customer's next message. */
  checksBlockedThisTurn: boolean;
  findings: string[];
  fixesTried: string[];
  likelyCause: string | null;
  /** Hardware problems found by the deterministic rules; any entry forces escalation. */
  hardwareIssues: string[];
}

export interface Handoff {
  to: "front_desk" | "human_engineer";
  reason: string;
  summary: {
    findings: string[];
    likelyCause: string | null;
    fixesTried: string[];
    hardwareIssues: string[];
  };
}

/* ---------- API responses ---------- */

export interface PendingApproval {
  callId: string;
  tool: string;
  title: string;
  readOnly: true;
  selfCheck: string;
}

export type ReplyStatus = "completed" | "approval_required" | "blocked";

export interface TroubleshootReply {
  sessionId: string;
  agent: "troubleshoot";
  status: ReplyStatus;
  reply: string;
  /** Checks that actually ran on the machine during this request. */
  toolsRun: string[];
  approvals?: PendingApproval[];
  decision?: Omit<TroubleshootDecision, "reply">;
  case: Pick<CaseState, "status" | "fixAttempts" | "checksRun">;
  handoff?: Handoff;
  /** Development only: why a guardrail blocked the message or reply. */
  debug?: Record<string, unknown>;
}
