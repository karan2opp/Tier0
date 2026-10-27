import { logger } from "../../common";
import {
  countRecentFailedAttempts,
  findCustomerByPhone,
  findDevicesForVerification,
  phoneKey,
  recordVerificationAttempt,
} from "./customers.repository";

/** The laptop the customer verified with: the one this call is about. */
export interface VerifiedLaptop {
  deviceId: string;
  name: string;
  serialEnding: string;
}

/** Cross-conversation limit: failed attempts allowed per phone number per window. */
export const PHONE_RATE_LIMIT = { maxFailures: 5, windowMs: 60 * 60 * 1000 } as const;

export type VerificationOutcome =
  | { status: "verified"; customerId: string; firstName: string; laptop: VerifiedLaptop }
  /** No phone number found in what the customer typed. */
  | { status: "need_phone" }
  /** A phone number was found, but no serial number to check it against. */
  | { status: "need_serial" }
  /** Too many failed attempts for this phone number recently, across all conversations. */
  | { status: "rate_limited" }
  /** Details were given but do not match. Counts as a failed attempt. */
  | { status: "no_match" };

/** Credentials found in the customer's own words. Extracted by code; the model never copies them. */
export interface Credentials {
  phones: string[];
  serials: string[];
}

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const PHONE = /\+?\d[\d\s-]{8,18}\d/g;
/** Serial numbers: 8-24 letters/digits (dashes allowed inside), with at least one digit and one letter. */
const SERIAL = /\b[a-z0-9](?:[a-z0-9-]{6,22})[a-z0-9]\b/gi;
/** Caps how many serial numbers one verification may try, so a message full of guesses does not help. */
const MAX_SERIAL_CANDIDATES = 3;

const isSerialLike = (token: string) => /\d/.test(token) && /[a-z]/i.test(token);
const normalizeSerial = (serial: string) => serial.replace(/[\s-]/g, "").toUpperCase();

export function extractCredentials(messages: string[]): Credentials {
  const text = messages.join("\n").replace(EMAIL, " ");
  const phones = [
    ...new Set((text.match(PHONE) ?? []).map((p) => p.replace(/\D/g, "")).filter((d) => d.length >= 10).map(phoneKey)),
  ];
  // Only real phone numbers (10+ digits) are removed, so a serial typed with dashes stays intact.
  const withoutPhones = text.replace(PHONE, (match) => (match.replace(/\D/g, "").length >= 10 ? " " : match));
  const tokens = (withoutPhones.match(SERIAL) ?? []).filter(isSerialLike).map(normalizeSerial);
  // Most recent first: the latest serial number the customer typed is the one that counts.
  const serials = [...new Set(tokens.reverse())].slice(0, MAX_SERIAL_CANDIDATES);
  return { phones, serials };
}

/**
 * Replaces phone numbers, emails, and serial numbers with placeholders. The model, the guardrails, and
 * the conversation history only ever see the redacted text, so these never leave the server.
 */
export function redactCredentials(message: string): string {
  return message
    .replace(EMAIL, "[email]")
    .replace(PHONE, (match) => (match.replace(/\D/g, "").length >= 10 ? "[phone number]" : match))
    .replace(SERIAL, (match) => (isSerialLike(match) ? "[serial number]" : match));
}

/**
 * Two-factor check, done entirely in code: the registered phone number AND the full serial number of one of
 * that customer's laptops (unique, long, printed under the laptop). The outcome never says which part was wrong.
 */
export async function verifyFromCustomerMessages(messages: string[]): Promise<VerificationOutcome> {
  const { phones, serials } = extractCredentials(messages);
  const phone = phones.at(-1);
  if (!phone) return { status: "need_phone" };
  if (serials.length === 0) return { status: "need_serial" };

  // Checked before looking anything up, so a locked phone number cannot be probed at all.
  if ((await countRecentFailedAttempts(phone, PHONE_RATE_LIMIT.windowMs)) >= PHONE_RATE_LIMIT.maxFailures) {
    logger.warn("Verification blocked: too many recent failed attempts for this phone number");
    return { status: "rate_limited" };
  }

  const customer = await findCustomerByPhone(phone);
  const customerDevices = customer ? await findDevicesForVerification(customer.id) : [];
  // Serials are most recent first, so the laptop they named last is the one the call is about.
  const device = serials
    .map((serial) => customerDevices.find((d) => normalizeSerial(d.serialNumber) === serial))
    .find(Boolean);

  await recordVerificationAttempt(phone, Boolean(device));
  if (!customer || !device) return { status: "no_match" };

  return {
    status: "verified",
    customerId: customer.id,
    firstName: customer.fullName.split(" ")[0],
    laptop: { deviceId: device.id, name: `${device.brand} ${device.model}`, serialEnding: device.serialNumber.slice(-4) },
  };
}

export { phoneKey };
