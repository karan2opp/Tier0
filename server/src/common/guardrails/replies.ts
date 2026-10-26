import type { InputCategory } from "./inputGuardrails";

/** What the customer hears when a guardrail blocks their message, by reason. Shared by all agents. */
export const BLOCKED_INPUT_REPLIES: Record<Exclude<InputCategory, "none">, string> = {
  prompt_injection:
    "I can only help with laptop support, and I can't change how I work. What problem are you having with your laptop?",
  harmful_request:
    "I can't run custom commands or do anything that could harm your laptop or data. I can run safe, read-only checks, or connect you to an engineer.",
  off_topic: "I'm Tier0's laptop support assistant, so I can only help with your laptop. What's going on with it?",
};

/** What the customer hears when a reply was blocked by the output guardrail. */
export const BLOCKED_OUTPUT_REPLY =
  "Sorry, I couldn't give a safe answer to that. Let me connect you with a human engineer who can help.";

/** Why a guardrail blocked something; returned to the client in development only (never in production). */
export function devGuardrailInfo(info: Record<string, unknown>) {
  return process.env.NODE_ENV === "production" ? {} : { debug: info };
}
