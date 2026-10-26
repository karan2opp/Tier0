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
  };
}

export function isClosed(state: CaseState) {
  return state.status === "resolved" || state.status === "escalated";
}

/** Short status line injected into the agent's instructions every turn. */
export function describeCase(state: CaseState): string {
  return [
    `Case status: ${state.status}.`,
    state.checkOffered
      ? "You have already offered checks, so you may request relevant checks directly."
      : "You have NOT offered a check yet: first give the self-check steps and offer (offer_check) before requesting any check.",
    `Checks run: ${state.checksRun} of ${CASE_LIMITS.maxChecks} for this case, ${state.checksThisTurn} of ${CASE_LIMITS.maxChecksPerTurn} for this reply.`,
    `Fix attempts: ${state.fixAttempts} of ${CASE_LIMITS.maxFixAttempts}.`,
    state.fixesTried.length ? `Fixes already tried: ${state.fixesTried.join("; ")}.` : "",
    state.hardwareIssues.length
      ? `HARDWARE PROBLEM DETECTED: ${state.hardwareIssues.join("; ")}. You must use escalate_to_human now.`
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
    state.hardwareIssues.length === 0 &&
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
  "We've tried a few things without fixing it, so I'm connecting you with a human engineer. They'll get everything we found, so you won't have to repeat yourself.";

const hardwareEscalationReply = (issues: string[]) =>
  `I found a hardware problem: ${issues[0].split(":")[0].toLowerCase()}. That needs a repair or replacement, so I'm handing you to a human engineer who can arrange it. They'll get everything we found, so you won't have to repeat yourself.`;

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
  const isFinal = decision.nextAction === "resolved" || decision.nextAction === "escalate_to_human";

  if (state.hardwareIssues.length > 0 && decision.nextAction !== "resolved") {
    // Rule: worn or failing hardware always goes to a human for repair or replacement.
    final = {
      ...decision,
      reply: decision.nextAction === "escalate_to_human" ? decision.reply : hardwareEscalationReply(state.hardwareIssues),
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

  if (final.nextAction === "resolved") {
    state.status = "resolved";
    return { decision: final, handoff: { to: "front_desk", reason: "Problem resolved", summary } };
  }
  if (final.nextAction === "escalate_to_human") {
    state.status = "escalated";
    return {
      decision: final,
      handoff: { to: "human_engineer", reason: final.escalationReason ?? "Needs a human engineer", summary },
    };
  }
  return { decision: final };
}

function mergeUnique(existing: string[], added: string[]) {
  return [...new Set([...existing, ...added.map((s) => s.trim()).filter(Boolean)])];
}
