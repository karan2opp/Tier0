import { z } from "zod";

export const handoffTargets = ["troubleshoot", "status", "human_agent"] as const;
export type FrontDeskHandoffTarget = (typeof handoffTargets)[number];

/** The front desk's structured decision, enforced on every turn. */
export const frontDeskDecisionSchema = z.object({
  reply: z.string().describe("What to say to the customer now, in plain spoken sentences, no markdown"),
  nextAction: z
    .enum(["ask_question", "answered", "handoff"])
    .describe(
      "ask_question: need details from the customer. answered: their question is answered or they are done. " +
        "handoff: a specialist should take over.",
    ),
  handoffTo: z.enum(handoffTargets).nullable().describe("Who should take over, only when nextAction is handoff"),
  handoffReason: z
    .string()
    .nullable()
    .describe("One sentence for the next agent: what the customer needs, e.g. 'Laptop has been slow for a week'"),
});

export type FrontDeskDecision = z.infer<typeof frontDeskDecisionSchema>;
