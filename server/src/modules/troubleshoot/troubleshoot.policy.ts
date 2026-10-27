import { detectHardwareIssues } from "./troubleshoot.hardware";
import type { CaseState, Handoff, TroubleshootDecision } from "./troubleshoot.schema";

/** Hard limits so the troubleshooting loop always ends in a decision. */
export const CASE_LIMITS = {
  maxFixAttempts: 3,
  maxChecks: 8,
  maxChecksPerTurn: 3,
} as const;

/** Confidence ceilings the server applies, whatever the model claims. */
const CONFIDENCE_CAPS = {
  noChecksRun: 50,
  noLikelyCause: 30,
} as const;

export function newCase(): CaseState {
  return {
    status: "investigating",
    checkOffered: false,
    fixAttempts: 0,
    checksRun: 0,
    checksThisTurn: 0,
    checksBlockedThisTurn: false,
    findings: [],
    fixesTried: [],
    likelyCause: null,
    hardwareIssues: [],
    hardwareMentioned: [],
    humanOffered: false,
  };
}

export function isClosed(state: CaseState) {
  return state.status === "resolved" || state.status === "escalated";
}

/** Short status line injected into the agent's instructions every turn. */
/** Why the diagnostic checks are not available right now, or null if they are. */
export function whyNoChecks(state: CaseState): string | null {
  if (!state.checkOffered) return null;
  if (state.checksRun >= CASE_LIMITS.maxChecks) return `the limit of ${CASE_LIMITS.maxChecks} checks for this case was reached`;
  if (state.checksThisTurn >= CASE_LIMITS.maxChecksPerTurn || state.checksBlockedThisTurn) {
    return "enough checks were run for this reply; answer the customer now";
  }
  return null;
}

export function describeCase(state: CaseState): string {
  const noChecks = whyNoChecks(state);
  return [
    `Case status: ${state.status}.`,
    state.checkOffered
      ? "You have already offered checks, so you may request relevant checks directly."
      : "You have NOT offered a check yet: first give the self-check steps and offer (offer_check) before requesting any check.",
    `Checks run: ${state.checksRun} of ${CASE_LIMITS.maxChecks} for this case, ${state.checksThisTurn} of ${CASE_LIMITS.maxChecksPerTurn} for this reply.`,
    `Fix attempts: ${state.fixAttempts} of ${CASE_LIMITS.maxFixAttempts}.`,
    state.fixesTried.length ? `Fixes already tried: ${state.fixesTried.join("; ")}.` : "",
    // Older check results are shortened in the history, so the findings live here.
    state.findings.length ? `Findings so far: ${state.findings.slice(-10).join("; ")}.` : "",
    state.hardwareIssues.length && !state.humanOffered
      ? `Hardware problem found: ${state.hardwareIssues.join("; ")}. If it is the cause of what the customer called ` +
        "about, explain it and use escalate_to_human (they are asked first). If it is unrelated, keep solving their " +
        "actual problem with checks as usual; a human engineer will be offered for the repair once that is done."
      : "",
    state.humanOffered
      ? `A human engineer was already offered (${state.hardwareIssues.join("; ") || "earlier in this call"}) and the ` +
        "customer chose to carry on with you. Help with what they ask now, including new problems. When you are done, " +
        "you may remind them the transfer to a human is still available."
      : "",
    noChecks
      ? `Checks are NOT available right now: ${noChecks}. Do not promise to run one; say so and give steps they can do themselves.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Whether the diagnostic tools are visible to the model right now. When false the model
 * cannot request a check at all, so it has to answer the customer instead.
 */
export function canRunChecks(state: CaseState): boolean {
  return (
    state.checkOffered &&
    !state.checksBlockedThisTurn &&
    state.checksRun < CASE_LIMITS.maxChecks &&
    state.checksThisTurn < CASE_LIMITS.maxChecksPerTurn
  );
}

/** Records a check that actually ran, plus any hardware problem in its readings. Called from inside the tool. */
export function recordCheckRun(state: CaseState, tool: string, output: unknown) {
  state.checksRun += 1;
  state.checksThisTurn += 1;
  state.hardwareIssues = mergeUnique(state.hardwareIssues, detectHardwareIssues(tool, output));
}

/**
 * Second line of defense, applied BEFORE a requested check is shown to the customer for approval
 * (e.g. the model requested several checks at once that together exceed a limit).
 * Returns the reason to auto-deny the request (sent to the agent), or null to let the customer decide.
 */
export function vetoChecks(state: CaseState, requested: number): string | null {
  if (!state.checkOffered) {
    return "Do not request checks yet. First explain briefly how the customer can check this themselves, offer to run the check for them (nextAction offer_check), and wait for them to ask.";
  }
  if (state.hardwareIssues.length > 0) {
    return "A hardware problem was found. Do not request more checks. Explain it and escalate to a human engineer.";
  }
  if (state.checksRun + requested > CASE_LIMITS.maxChecks) {
    return "The check limit for this case is reached. Do not request more checks. Based on what you know, suggest a fix or escalate to a human engineer.";
  }
  if (state.checksThisTurn + requested > CASE_LIMITS.maxChecksPerTurn) {
    return "You have run enough checks for this reply. Do not request more now. Explain what you found to the customer and decide the next action.";
  }
  return null;
}

const FORCED_ESCALATION_REPLY =
  "We've tried a few things without fixing it, so a human engineer is the best next step. They'll get everything we found, so you won't have to repeat yourself. Would you like me to transfer you to a human engineer now, or is there anything else you'd like to ask first?";

/** "Battery health is 61.5%, below 70%: the battery needs replacing" -> one plain sentence for the customer. */
function hardwareSentence(issue: string): string {
  const [what, consequence] = issue.split(": ");
  const lower = what.charAt(0).toLowerCase() + what.slice(1);
  return `I also noticed that ${lower}${consequence ? `, so ${consequence}` : ""}. A human engineer can arrange the repair.`;
}

/** Adds a note to a reply, before its closing question if it has one, so the reply still ends by asking. */
function addBeforeQuestion(reply: string, note: string): string {
  const text = reply.trim();
  const question = text.match(/[^.!?]*\?\s*$/);
  if (!question || question.index === 0) return `${text} ${note}`;
  return `${text.slice(0, question.index).trim()} ${note} ${question[0].trim()}`;
}

/** Whether the reply already tells the customer about this hardware problem. */
const mentions = (reply: string, issue: string) =>
  (/battery/i.test(issue) && /battery/i.test(reply)) || (/disk/i.test(issue) && /\b(disk|drive|storage)\b/i.test(reply));

/** The model's confidence can never exceed what the evidence supports. */
function calibrateConfidence(state: CaseState, decision: TroubleshootDecision): number {
  let confidence = decision.confidence;
  if (state.checksRun === 0) confidence = Math.min(confidence, CONFIDENCE_CAPS.noChecksRun);
  if (!decision.likelyCause) confidence = Math.min(confidence, CONFIDENCE_CAPS.noLikelyCause);
  return confidence;
}

/**
 * Applies the agent's decision to the case and enforces the rules. The model proposes;
 * the server decides when the loop must end.
 */
export function applyDecision(
  state: CaseState,
  proposed: TroubleshootDecision,
): { decision: TroubleshootDecision; handoff?: Handoff } {
  const decision = { ...proposed, confidence: calibrateConfidence(state, proposed) };

  state.findings = mergeUnique(state.findings, decision.findings);
  state.likelyCause = decision.likelyCause ?? state.likelyCause;
  if (decision.nextAction === "offer_check") state.checkOffered = true;

  if (decision.nextAction === "try_fix") {
    state.fixAttempts += 1;
    state.fixesTried = mergeUnique(state.fixesTried, decision.fixes.map((fix) => fix.title));
    state.status = "fixing";
  }

  let final = decision;
  const isFinal = ["resolved", "escalate_to_human", "other_topic", "done"].includes(decision.nextAction);

  // Rule: a hardware problem is always told to the customer once, but never takes over the call. The engineer keeps
  // working on what the customer actually called about.
  const untold = state.hardwareIssues.filter((issue) => !state.hardwareMentioned.includes(issue));
  if (untold.length > 0) {
    const extra = untold.filter((issue) => !mentions(decision.reply, issue)).map(hardwareSentence);
    if (extra.length > 0) final = { ...final, reply: addBeforeQuestion(final.reply, extra.join(" ")) };
    state.hardwareMentioned = mergeUnique(state.hardwareMentioned, untold);
  }

  // Their problem is sorted (or they are done) but a part still needs repairing: offer the human engineer now,
  // before they go. Asked once; they are only transferred if they say yes.
  const finishing = decision.nextAction === "resolved" || decision.nextAction === "done";
  if (finishing && state.hardwareIssues.length > 0 && !state.humanOffered) {
    final = {
      ...final,
      reply: `${final.reply.trim()} Before you go, the ${state.hardwareIssues.some((i) => /battery/i.test(i)) ? "battery" : "disk"} still needs a repair, which a human engineer can arrange.`,
      nextAction: "escalate_to_human",
      escalationReason: `Hardware repair needed: ${state.hardwareIssues.join("; ")}`,
    };
  } else if (!isFinal) {
    const outOfAttempts = state.fixAttempts > CASE_LIMITS.maxFixAttempts;
    const outOfChecks = state.checksRun >= CASE_LIMITS.maxChecks && decision.nextAction === "offer_check";
    if (outOfAttempts || outOfChecks) {
      final = {
        ...decision,
        reply: FORCED_ESCALATION_REPLY,
        nextAction: "escalate_to_human",
        escalationReason: outOfAttempts ? "Fix attempt limit reached" : "Diagnostic check limit reached",
      };
    }
  }

  const summary = {
    findings: state.findings,
    likelyCause: state.likelyCause,
    fixesTried: state.fixesTried,
    hardwareIssues: state.hardwareIssues,
  };

  if (final.nextAction === "resolved" || final.nextAction === "done") {
    // Solved: the engineer stays on the line and asks if there is anything else, instead of transferring.
    state.status = "resolved";
    const reply = final.nextAction === "resolved" ? askAnythingElse(final.reply) : final.reply;
    return { decision: { ...final, reply } };
  }
  if (final.nextAction === "other_topic") {
    // Another team can help; the conversation offers the transfer and waits for the customer's yes.
    return {
      decision: final,
      handoff: { to: "front_desk", reason: final.escalationReason ?? "The customer asked about something other than a laptop problem", summary },
    };
  }
  if (final.nextAction === "escalate_to_human") {
    state.status = "escalated";
    state.humanOffered = true;
    return {
      decision: final,
      handoff: { to: "human_engineer", reason: final.escalationReason ?? "Needs a human engineer", summary },
    };
  }
  return { decision: final };
}

const ANYTHING_ELSE = "Is there anything else I can help you with?";

/** A solved case always ends with an offer to help further, never a silent transfer. */
function askAnythingElse(reply: string): string {
  return /\?\s*$/.test(reply.trim()) ? reply : `${reply.trim()} ${ANYTHING_ELSE}`;
}

function mergeUnique(existing: string[], added: string[]) {
  return [...new Set([...existing, ...added.map((s) => s.trim()).filter(Boolean)])];
}
