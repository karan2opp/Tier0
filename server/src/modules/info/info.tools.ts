import { tool, type RunContext } from "@openai/agents";
import { z } from "zod";
import { logger } from "../../common";
import { wrapUntrustedToolOutput } from "../../common/guardrails";
import { findDevicesWithWarranties } from "../customers/customers.repository";
import { verifyFromCustomerMessages } from "../customers/customers.service";
import type { InfoSession } from "./info.schema";
import { WARRANTY_PLANS } from "./info.warranty";

export interface InfoContext {
  session: InfoSession;
}

export const MAX_VERIFICATION_ATTEMPTS = 3;

const DAY = 24 * 60 * 60 * 1000;
const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);

const noParams = z.object({});

export const verifyCustomerTool = tool<typeof noParams, InfoContext>({
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
  execute: async (_input, runContext?: RunContext<InfoContext>) => {
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
        return wrapUntrustedToolOutput("verify_customer", {
          verified: false,
          missing: "Their registered phone number.",
        });
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

export const laptopsAndWarrantiesTool = tool<typeof noParams, InfoContext>({
  name: "get_my_laptops_and_warranties",
  description:
    "The verified customer's laptops with their warranty: plan, start and end dates, whether it is active, days left, " +
    "and what the plan covers and does not cover.",
  parameters: noParams,
  // Only once the customer is verified (it always reads THAT customer's data), and once per message.
  isEnabled: ({ runContext }) => {
    const { session } = runContext.context;
    return Boolean(session.customerId) && session.lookupsThisTurn < 1;
  },
  execute: async (_input, runContext?: RunContext<InfoContext>) => {
    const session = runContext!.context.session;
    session.lookupsThisTurn += 1;
    const customerId = session.customerId!;
    const now = today();
    const laptops = (await findDevicesWithWarranties(customerId)).map((device) => {
      const latest = [...device.warranties].sort((a, b) => b.endsOn.localeCompare(a.endsOn))[0];
      const plan = latest ? WARRANTY_PLANS[latest.plan] : null;
      const daysLeft = latest ? daysBetween(now, latest.endsOn) : null;
      return {
        laptop: `${device.brand} ${device.model}`,
        serialEnding: device.serialNumber.slice(-4),
        purchaseDate: device.purchaseDate,
        warranty: latest && plan
          ? {
              plan: plan.name,
              startsOn: latest.startsOn,
              endsOn: latest.endsOn,
              active: daysLeft! >= 0,
              daysLeft: daysLeft! >= 0 ? daysLeft : 0,
              expiredDaysAgo: daysLeft! < 0 ? -daysLeft! : null,
              covers: plan.covers,
              notCovered: plan.notCovered,
            }
          : null,
      };
    });
    return wrapUntrustedToolOutput("get_my_laptops_and_warranties", { today: now, laptops });
  },
});
