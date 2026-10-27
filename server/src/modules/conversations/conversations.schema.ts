import { z } from "zod";

export const conversationParamsSchema = z.object({ sessionId: z.uuid() });

export const sendMessageSchema = z.object({
  message: z.string().trim().min(1, "Message is required").max(2000, "Message is too long"),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const approvalSchema = z.object({ approve: z.boolean() });

export const agentNames = ["front_desk", "troubleshoot", "status", "human_agent"] as const;
export type AgentName = (typeof agentNames)[number];
export type SpecialistName = "troubleshoot" | "status";

/** One line of the call, redacted: phone numbers and serial numbers never appear here. */
export interface TranscriptEntry {
  role: "customer" | "agent";
  agent?: AgentName;
  text: string;
  at: string;
}

export interface HandoffRecord {
  from: AgentName;
  to: AgentName;
  reason: string;
  at: string;
}

/** What the human agent gets when the call is escalated. */
export interface Escalation {
  from: AgentName;
  reason: string;
  at: string;
  customer: CustomerSummary | null;
  /** The troubleshoot case (findings, likely cause, fixes tried), when it came from there. */
  caseSummary?: unknown;
}

export interface CustomerSummary {
  firstName: string | null;
  laptop: string | null;
}

/** One agent's turn, in the same shape whichever agent ran. */
export interface AgentTurn {
  agent: AgentName;
  status: "completed" | "approval_required" | "blocked";
  reply: string;
  toolsRun: string[];
  approvals?: unknown[];
  handoff?: { to: AgentName; reason: string; caseSummary?: unknown };
  /** The agent's structured decision without the reply (next action, confidence, fixes...). */
  decision?: unknown;
  debug?: Record<string, unknown>;
}

export type ConversationStatus = "completed" | "approval_required" | "blocked" | "with_human";

export interface ConversationReply {
  sessionId: string;
  status: ConversationStatus;
  /** Who the customer is talking to now. */
  activeAgent: AgentName;
  /** Everything said in this request, in order; a handoff gives two (the transfer and the specialist's reply). */
  messages: { agent: AgentName; text: string }[];
  verified: boolean;
  customer: CustomerSummary | null;
  toolsRun: { agent: AgentName; tool: string }[];
  /** A check or change waiting for the customer's yes or no. */
  approval?: { agent: AgentName; items: unknown[] };
  handoffs: HandoffRecord[];
  decisions: { agent: AgentName; decision: unknown }[];
  escalation?: Escalation;
  /** Development only: why a guardrail blocked something. */
  debug?: Record<string, unknown>[];
}
