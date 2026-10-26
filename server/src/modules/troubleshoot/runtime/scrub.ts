import os from "node:os";

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const username = os.userInfo().username;
const hostname = os.hostname();

// Identity values that must never leave this machine (tool output goes to the LLM).
// The username is only replaced as a path segment (C:\Users\name\...) or an account (PC\name),
// so a username like "acer" does not also erase the brand "Acer". Tools never output a bare username field.
const patterns: Array<[RegExp, string]> = [
  // Per-account Windows SIDs (S-1-5-21-<domain>-<rid>) uniquely identify the user. Well-known
  // short SIDs like S-1-5-18 (SYSTEM) are kept because they are the same on every machine.
  [/\bS-1-5-21(?:-\d+){3,}\b/gi, "<sid>"],
];
if (username.length >= 2) {
  patterns.push([new RegExp(`(?<=[\\\\/])${escapeRegExp(username)}(?=[\\\\/]|\\b)`, "gi"), "<user>"]);
}
if (hostname.length >= 2) {
  patterns.push([new RegExp(`\\b${escapeRegExp(hostname)}\\b`, "gi"), "<host>"]);
}

/** Recursively replaces the Windows username and computer name in any string value. */
export function scrub<T>(value: T): T {
  if (typeof value === "string") {
    return patterns.reduce<string>((text, [pattern, placeholder]) => text.replace(pattern, placeholder), value) as T;
  }
  if (Array.isArray(value)) {
    return value.map(scrub) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v)])) as T;
  }
  return value;
}
