import { z } from "zod";

export const sendMessageSchema = z.object({
  sessionId: z.uuid().optional(),
  message: z.string().trim().min(1, "Message is required").max(2000, "Message is too long"),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const handoffTargets = ["troubleshoot", "status", "human_agent", "front_desk"] as const;
export type HandoffTarget = (typeof handoffTargets)[number];

/** The agent's structured decision, enforced on every turn. */
export const infoDecisionSchema = z.object({
  reply: z.string().describe("What to say to the customer now, in plain spoken sentences, no markdown"),
  nextAction: z
    .enum(["ask_question", "answered", "handoff"])
    .describe("ask_question: need details from the customer. answered: the question is answered. handoff: another team should take over."),
  handoffTo: z.enum(handoffTargets).nullable().describe("Who should take over, only when nextAction is handoff"),
  handoffReason: z.string().nullable().describe("Why, only when nextAction is handoff"),
});

export type InfoDecision = z.infer<typeof infoDecisionSchema>;

/** Verification state kept by the server, never by the model. */
export interface InfoSession {
  customerId: string | null;
  firstName: string | null;
  failedAttempts: number;
  locked: boolean;
  /** Verification attempts since the customer's last message (max one per message). */
  attemptsThisTurn: number;
  /** Laptop and warranty lookups since the customer's last message (max one: it returns everything). */
  lookupsThisTurn: number;
  /** Everything the customer has typed in this conversation; verification may only use these details. */
  customerMessages: string[];
}

export type ReplyStatus = "completed" | "blocked";

export interface InfoReply {
  sessionId: string;
  agent: "info";
  status: ReplyStatus;
  reply: string;
  verified: boolean;
  toolsRun: string[];
  decision?: Omit<InfoDecision, "reply">;
  handoff?: { to: HandoffTarget; reason: string };
  /** Development only: why a guardrail blocked the message or reply. */
  debug?: Record<string, unknown>;
}
