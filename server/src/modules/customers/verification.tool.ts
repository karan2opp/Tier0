import { tool, type RunContext } from "@openai/agents";
import { z } from "zod";
import { logger } from "../../common";
import { wrapUntrustedToolOutput } from "../../common/guardrails";
import { verifyFromCustomerMessages } from "./customers.service";

/** Failed attempts allowed in one conversation before it locks and goes to a human. */
export const MAX_VERIFICATION_ATTEMPTS = 3;

/** Identity state kept by the server (never by the model), shared by every agent that needs a verified customer. */
export interface VerificationState {
  customerId: string | null;
  firstName: string | null;
  failedAttempts: number;
  locked: boolean;
  /** Verification attempts since the customer's last message (max one per message). */
  attemptsThisTurn: number;
  /** Original customer messages (server only); verification reads the phone and serial number from these. */
  customerMessages: string[];
}

export interface VerificationContext {
  session: VerificationState;
}

export function newVerificationState(): VerificationState {
  return { customerId: null, firstName: null, failedAttempts: 0, locked: false, attemptsThisTurn: 0, customerMessages: [] };
}

/** Call for every new customer message: allows one more attempt and makes its details usable for verification. */
export function startCustomerTurn(state: VerificationState, message: string) {
  state.attemptsThisTurn = 0;
  state.customerMessages.push(message);
}

/** Call when a message was blocked by a guardrail: its details must not be used. */
export function forgetLastCustomerMessage(state: VerificationState) {
  state.customerMessages.pop();
}

/** Short status line for an agent's instructions. */
export function describeVerification(state: VerificationState): string {
  if (state.locked) return "Verification status: LOCKED after too many failed attempts. Hand off to a human agent.";
  if (state.customerId) return `Verification status: customer verified (first name: ${state.firstName}).`;
  return `Verification status: NOT verified yet (${state.failedAttempts} failed attempts so far).`;
}

const noParams = z.object({});

/** The verify_customer tool, typed for the calling agent's context. */
export function createVerifyCustomerTool<TContext extends VerificationContext>() {
  return tool<typeof noParams, TContext>({
    name: "verify_customer",
    description:
      "Verify who the customer is before sharing any account details. Takes no arguments: it reads the registered phone " +
      "number and the laptop serial number from what the customer typed (you only see them as [phone number] and " +
      "[serial number]). Call it once the customer has shared their details; it tells you if something is still missing.",
    // No arguments on purpose: the model never copies (or mistypes, or invents) credentials.
    parameters: noParams,
    // Only offered until the customer is verified, at most once per customer message, never once locked.
    isEnabled: ({ runContext }) => {
      const { session } = runContext.context;
      return !session.customerId && !session.locked && session.attemptsThisTurn < 1;
    },
    execute: async (_input, runContext?: RunContext<TContext>) => {
      const session = runContext!.context.session;
      // Parallel calls in one model step can slip past isEnabled; the tool itself also enforces one try per message.
      if (session.attemptsThisTurn >= 1 || session.customerId || session.locked) {
        return wrapUntrustedToolOutput("verify_customer", {
          verified: Boolean(session.customerId),
          note: "Only one verification attempt per customer message. Answer the customer now.",
        });
      }
      session.attemptsThisTurn += 1;

      const outcome = await verifyFromCustomerMessages(session.customerMessages);

      switch (outcome.status) {
        case "verified":
          session.customerId = outcome.customerId;
          session.firstName = outcome.firstName;
          logger.info({ failedAttemptsBefore: session.failedAttempts }, "Customer verified");
          return wrapUntrustedToolOutput("verify_customer", { verified: true, firstName: outcome.firstName });

        // Missing details are not a failed attempt: the customer simply has not shared them yet.
        case "need_phone":
          return wrapUntrustedToolOutput("verify_customer", { verified: false, missing: "Their registered phone number." });
        case "need_serial":
          return wrapUntrustedToolOutput("verify_customer", {
            verified: false,
            missing: "The full serial number (S/N) of their laptop, printed on the sticker under the laptop.",
          });
        case "rate_limited":
          session.locked = true;
          return wrapUntrustedToolOutput("verify_customer", {
            verified: false,
            locked: true,
            note: "Too many failed attempts for this account recently. Do not ask for details again; a human agent must help.",
          });

        case "no_match":
          session.failedAttempts += 1;
          session.locked = session.failedAttempts >= MAX_VERIFICATION_ATTEMPTS;
          logger.warn({ failedAttempts: session.failedAttempts, locked: session.locked }, "Customer verification failed");
          return wrapUntrustedToolOutput("verify_customer", {
            verified: false,
            attemptsLeft: Math.max(0, MAX_VERIFICATION_ATTEMPTS - session.failedAttempts),
            locked: session.locked,
            note: "The details do not match our records. Do not say which detail was wrong.",
          });
      }
    },
  });
}
