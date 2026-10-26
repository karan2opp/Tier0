import {
  findCustomerByEmail,
  findCustomerByPhone,
  findSerialNumbers,
  phoneKey,
} from "./customers.repository";

export type VerificationOutcome =
  | { status: "verified"; customerId: string; firstName: string }
  /** No phone number or email found in what the customer typed. */
  | { status: "need_identifier" }
  /** A phone or email was found, but no second detail to check it against. */
  | { status: "need_proof" }
  /** Details matched more than one customer; ask for one account's details only. */
  | { status: "ambiguous" }
  /** Details were given but do not match. Counts as a failed attempt. */
  | { status: "no_match" };

/** Credentials found in the customer's own words. Extracted by code, never copied by the model. */
interface Credentials {
  emails: string[];
  phones: string[];
  serialEndings: string[];
}

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const PHONE = /\+?\d[\d\s-]{8,18}\d/g;
const TOKEN = /\b[a-z0-9]{4,20}\b/gi;
/** Caps how many serial endings one verification may try, so it cannot be used to brute-force. */
const MAX_SERIAL_CANDIDATES = 6;

export function extractCredentials(messages: string[]): Credentials {
  const text = messages.join("\n");
  const emails = [...new Set((text.match(EMAIL) ?? []).map((e) => e.toLowerCase()))];
  const withoutEmails = text.replace(EMAIL, " ");

  const phones = [
    ...new Set(
      (withoutEmails.match(PHONE) ?? []).map((p) => p.replace(/\D/g, "")).filter((d) => d.length >= 10).map(phoneKey),
    ),
  ];
  const withoutContacts = withoutEmails.replace(PHONE, " ");

  // Serial endings: short tokens containing at least one digit (e.g. "4501", "7B3C"), most recent first.
  const tokens = (withoutContacts.match(TOKEN) ?? []).filter((t) => /\d/.test(t)).map((t) => t.toLowerCase());
  const serialEndings = [...new Set(tokens.reverse())].slice(0, MAX_SERIAL_CANDIDATES);

  return { emails, phones, serialEndings };
}

/**
 * Two-factor check, done entirely in code:
 *  - identifier: a registered phone number or email (finds the customer)
 *  - proof: a DIFFERENT factor: the other contact detail, or the ending of one of their laptop serial numbers
 * The outcome never says which part was wrong, so it cannot be used to probe who is a customer.
 */
export async function verifyFromCustomerMessages(messages: string[]): Promise<VerificationOutcome> {
  const { emails, phones, serialEndings } = extractCredentials(messages);
  if (emails.length === 0 && phones.length === 0) return { status: "need_identifier" };

  const candidates = new Map<string, { id: string; fullName: string; email: string; phone: string }>();
  for (const email of emails) {
    const customer = await findCustomerByEmail(email);
    if (customer) candidates.set(customer.id, customer);
  }
  for (const phone of phones) {
    const customer = await findCustomerByPhone(phone);
    if (customer) candidates.set(customer.id, customer);
  }

  const hasSecondFactor = emails.length + phones.length >= 2 || serialEndings.length > 0;

  const verified: Array<{ id: string; fullName: string }> = [];
  for (const customer of candidates.values()) {
    const emailMatches = emails.includes(customer.email.toLowerCase());
    const phoneMatches = phones.includes(phoneKey(customer.phone));
    let serialMatches = false;
    if (serialEndings.length > 0) {
      const serials = (await findSerialNumbers(customer.id)).map((s) => s.toLowerCase());
      serialMatches = serials.some((serial) => serialEndings.some((ending) => serial.endsWith(ending)));
    }
    // Two different factors must match the same customer.
    const factors = [emailMatches, phoneMatches, serialMatches].filter(Boolean).length;
    if (factors >= 2) verified.push(customer);
  }

  if (verified.length === 1) {
    return { status: "verified", customerId: verified[0].id, firstName: verified[0].fullName.split(" ")[0] };
  }
  if (verified.length > 1) return { status: "ambiguous" };
  return hasSecondFactor ? { status: "no_match" } : { status: "need_proof" };
}
