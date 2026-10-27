/**
 * Short phrases an agent says while it works, so the line never goes silent ("Okay, let me check that for you.").
 * A fixed list: the server only ever speaks these or the agents' own lines, so the voice endpoints cannot be used
 * to generate arbitrary audio, and each phrase is generated once and then reused.
 */
export const FILLERS = {
  /** After the customer says something. */
  thinking: [
    "Okay, let me check that for you.",
    "Sure, one moment.",
    "Got it, let me look into that.",
    "Alright, give me a second.",
  ],
  /** After the customer shares their phone number and serial number. */
  verifying: ["Thanks, let me verify those details.", "Thank you, checking your details now."],
  /** After the customer allows a diagnostic check on their laptop. */
  checking: ["Okay, running that check on your laptop now.", "Running the check now, it only takes a few seconds."],
  /** When an answer is taking unusually long. */
  still: ["Still on it, almost there.", "Thanks for waiting, nearly done."],
} as const;

export type FillerKind = keyof typeof FILLERS;
export const fillerKinds = Object.keys(FILLERS) as FillerKind[];
