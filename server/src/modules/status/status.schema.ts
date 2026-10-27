import { z } from "zod";
import type { VerificationState } from "../customers/verification.tool";
import type { VisitKind } from "./status.repository";

export const handoffTargets = ["troubleshoot", "front_desk", "human_agent"] as const;
export type HandoffTarget = (typeof handoffTargets)[number];

/** The agent's structured decision, enforced on every turn. */
export const statusDecisionSchema = z.object({
  reply: z.string().describe("What to say to the customer now, in plain spoken sentences, no markdown"),
  nextAction: z
    .enum(["ask_question", "answered", "handoff", "done"])
    .describe(
      "ask_question: need details or a choice from the customer. answered: their question is answered. " +
        "handoff: another team should take over (the customer is asked first). done: they need nothing else; the reply is a goodbye.",
    ),
  handoffTo: z.enum(handoffTargets).nullable().describe("Who should take over, only when nextAction is handoff"),
  handoffReason: z.string().nullable().describe("Why, only when nextAction is handoff"),
});
export type StatusDecision = z.infer<typeof statusDecisionSchema>;

/** A visit window the agent offered; reschedule_visit only accepts these, by id. */
export interface OfferedSlot {
  ticketId: string;
  ticketNumber: string;
  kind: VisitKind;
  start: string;
  end: string;
  label: string;
  /** The customer turn in which it was offered; it can only be chosen in a LATER turn. */
  offeredInTurn: number;
}

export interface StatusSession {
  /** The conversation's verified identity, shared with the front desk. */
  identity: VerificationState;
  /** Increases with every customer message. */
  turn: number;
  /** Whether the customer's latest message asks to change a booking (detected by the server, not the model). */
  customerAskedForChange: boolean;
  /** Repair lookups since the customer's last message (max one: it returns everything). */
  lookupsThisTurn: number;
  /** Slot lookups since the customer's last message (max one). */
  slotLookupsThisTurn: number;
  /** Saved changes since the customer's last message (max one). */
  changesThisTurn: number;
  /** Slots offered in this conversation, by slot id ("S1", "S2", ...). */
  offeredSlots: Record<string, OfferedSlot>;
  slotCounter: number;
}

export interface PendingChange {
  callId: string;
  action: "reschedule_visit";
  description: string;
}

export type ReplyStatus = "completed" | "approval_required" | "blocked";

export interface StatusReply {
  sessionId: string;
  agent: "status";
  status: ReplyStatus;
  reply: string;
  toolsRun: string[];
  approvals?: PendingChange[];
  decision?: Omit<StatusDecision, "reply">;
  handoff?: { to: HandoffTarget; reason: string };
  /** Development only: why a guardrail blocked the message or reply. */
  debug?: Record<string, unknown>;
}
