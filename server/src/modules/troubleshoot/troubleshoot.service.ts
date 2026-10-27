import {
  InputGuardrailTripwireTriggered,
  OutputGuardrailTripwireTriggered,
  run,
  type Agent,
  type AgentInputItem,
  type RunResult,
  type RunState,
  type RunToolApprovalItem,
} from "@openai/agents";
import {
  AppError,
  compactHistory,
  ConflictError,
  logger,
  NotFoundError,
  ServiceUnavailableError,
  SupersededError,
} from "../../common";
import {
  BLOCKED_INPUT_REPLIES,
  BLOCKED_OUTPUT_REPLY,
  devGuardrailInfo,
  type InputCheck,
  type OutputCheck,
} from "../../common/guardrails";
import { LocalToolProvider } from "./providers/local.provider";
import type { ToolProvider } from "./providers/provider";
import { scrub } from "./runtime/scrub";
import { createTroubleshootAgent, type TroubleshootContext } from "./troubleshoot.agent";
import { applyDecision, isClosed, newCase, vetoChecks } from "./troubleshoot.policy";
import type {
  CaseState,
  Handoff,
  PendingApproval,
  TroubleshootDecision,
  TroubleshootReply,
  troubleshootDecisionSchema,
} from "./troubleshoot.schema";
import { getTool, toolDefinitions } from "./tools/definitions";

const MAX_TURNS = 10;

const DECLINED_MESSAGE =
  "The customer declined this check. Do not run it again. Continue with steps they can do themselves.";

export interface TroubleshootInput {
  sessionId: string;
  /** The customer's message, already redacted. */
  message: string;
  /** What happened before this agent took over (or since it last spoke), added before the message. */
  briefing?: AgentInputItem[];
  /** Aborted when the customer adds to their message before this answer is ready. */
  signal?: AbortSignal;
}

interface Session {
  history: AgentInputItem[];
  caseState: CaseState;
  /** A run paused at a tool approval. Must be approved or denied before the next message. */
  pending?: RunState<TroubleshootContext, any>;
  handoff?: Handoff;
  /** Tool call IDs already counted, so each check is counted once across resumed runs. */
  countedCallIds: Set<string>;
}

/** How many times the server may auto-deny check requests in one request before giving up. */
const MAX_VETO_ROUNDS = 4;

export class TroubleshootService {
  private readonly agent: Agent<TroubleshootContext, typeof troubleshootDecisionSchema>;
  // In memory for now; moves to the DB later.
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly provider: ToolProvider) {
    this.agent = createTroubleshootAgent(provider);
  }

  listTools() {
    return toolDefinitions.map(({ name, title, description }) => ({ name, title, description }));
  }

  async runTool(name: string, args: unknown) {
    return { tool: name, provider: this.provider.name, result: await this.provider.run(name, args) };
  }

  async handleMessage({ sessionId: id, message, briefing = [], signal }: TroubleshootInput): Promise<TroubleshootReply> {
    this.ensureConfigured();
    const session = this.getOrCreateSession(id);

    // A solved case stays on the line: what the customer says next starts a fresh case (another problem),
    // with the conversation so far still in the history.
    if (session.caseState.status === "resolved") {
      session.caseState = newCase();
      session.handoff = undefined;
    }
    // A human was offered but the customer carried on with the engineer (another question, or a new problem):
    // the case continues. If they had said yes, the conversation would have transferred them instead.
    if (session.caseState.status === "escalated") {
      // Counted afresh, so a long first investigation leaves room for checks on the new problem.
      Object.assign(session.caseState, { status: "investigating", checksRun: 0, fixAttempts: 0, fixesTried: [] });
    }
    if (isClosed(session.caseState)) {
      throw new ConflictError(`This case is already ${session.caseState.status}. Start a new conversation for a new problem.`, {
        details: { handoff: session.handoff },
      });
    }
    if (session.pending) {
      throw new ConflictError("Please allow or deny the pending check first", {
        details: { approvals: session.pending.getInterruptions().map(toPendingApproval) },
      });
    }

    // A new customer message starts a new "turn" for the per-reply check limit.
    session.caseState.checksThisTurn = 0;
    session.caseState.checksBlockedThisTurn = false;
    const input: AgentInputItem[] = [...compactHistory(session.history), ...briefing, { role: "user", content: message }];
    const context: TroubleshootContext = { caseState: session.caseState };
    // Safe to retry: no check can run before the customer approves it, so a fresh run has no side effects.
    return this.execute(id, session, () => run(this.agent, input, { context, maxTurns: MAX_TURNS, signal }), {
      retryBlockedOutput: true,
      signal,
    });
  }

  async handleApproval(sessionId: string, approve: boolean): Promise<TroubleshootReply> {
    this.ensureConfigured();
    const session = this.sessions.get(sessionId);
    if (!session?.pending) throw new NotFoundError("There is no check waiting for approval in this session");

    const state = session.pending;
    session.pending = undefined;
    const items = state.getInterruptions();
    for (const item of items) {
      if (approve) state.approve(item);
      else state.reject(item, { message: DECLINED_MESSAGE });
    }
    logger.info({ sessionId, approve, tools: items.map((item) => item.name) }, "Customer decided on diagnostic checks");

    // The run state carries the same case context, so the agent resumes exactly where it paused.
    return this.execute(sessionId, session, () => run(this.agent, state, { maxTurns: MAX_TURNS }));
  }

  private getOrCreateSession(id: string): Session {
    let session = this.sessions.get(id);
    if (!session) {
      session = { history: [], caseState: newCase(), countedCallIds: new Set() };
      this.sessions.set(id, session);
    }
    return session;
  }

  private async execute(
    sessionId: string,
    session: Session,
    runAgent: () => Promise<RunResult<TroubleshootContext, any>>,
    { retryBlockedOutput = false, signal }: { retryBlockedOutput?: boolean; signal?: AbortSignal } = {},
  ): Promise<TroubleshootReply> {
    const base = { sessionId, agent: "troubleshoot" as const };
    const caseSummary = () => ({
      status: session.caseState.status,
      fixAttempts: session.caseState.fixAttempts,
      checksRun: session.caseState.checksRun,
    });

    try {
      const toolsRun: string[] = [];
      let result = await this.runWithRetry(sessionId, runAgent, retryBlockedOutput);
      this.collectChecksRun(session, result, toolsRun);

      // Second line of defense: requests that break the rules are denied before the customer sees them,
      // and the tools are hidden for the rest of this reply so the agent has to answer instead.
      for (let round = 0; result.interruptions.length > 0; round++) {
        const veto = vetoChecks(session.caseState, result.interruptions.length);
        if (!veto) break;
        if (round >= MAX_VETO_ROUNDS) throw new ServiceUnavailableError("The troubleshoot agent kept requesting checks");
        logger.info(
          { sessionId, tools: result.interruptions.map((item) => item.name), reason: veto },
          "Check request auto-denied by policy",
        );
        session.caseState.checksBlockedThisTurn = true;
        for (const item of result.interruptions) result.state.reject(item, { message: veto });
        result = await run(this.agent, result.state, { maxTurns: MAX_TURNS, signal });
        this.collectChecksRun(session, result, toolsRun);
      }

      if (result.interruptions.length > 0) {
        session.pending = result.state;
        const approvals = result.interruptions.map(toPendingApproval);
        return {
          ...base,
          status: "approval_required",
          reply: approvalPrompt(approvals),
          toolsRun,
          approvals,
          case: caseSummary(),
        };
      }

      const raw = result.finalOutput as TroubleshootDecision | undefined;
      if (!raw) throw new ServiceUnavailableError("The troubleshoot agent returned no decision");

      // Defense in depth: scrub identity data from everything the customer sees.
      const { decision, handoff } = applyDecision(session.caseState, scrub(raw));
      session.history = result.history;
      if (handoff) session.handoff = handoff;

      logger.info(
        { sessionId, nextAction: decision.nextAction, confidence: decision.confidence, case: caseSummary(), handoff: handoff?.to },
        "Troubleshoot decision",
      );

      const { reply, ...details } = decision;
      return { ...base, status: "completed", reply, toolsRun, decision: details, case: caseSummary(), handoff };
    } catch (err) {
      // Dropped for a newer message. No check can have run (each needs the customer's approval first).
      if (signal?.aborted) throw new SupersededError();
      if (err instanceof InputGuardrailTripwireTriggered) {
        const check = err.result.output.outputInfo as InputCheck;
        const category = check.category === "none" ? "prompt_injection" : check.category;
        logger.warn({ sessionId, category, reason: check.reason, source: check.source }, "Input guardrail blocked a message");
        // The blocked message is not added to the history.
        return {
          ...base,
          status: "blocked",
          reply: BLOCKED_INPUT_REPLIES[category],
          toolsRun: [],
          case: caseSummary(),
          ...devGuardrailInfo({ guardrail: "input", category, reason: check.reason, source: check.source }),
        };
      }
      if (err instanceof OutputGuardrailTripwireTriggered) {
        const check = err.result.output.outputInfo as OutputCheck;
        logger.warn({ sessionId, reason: check.reason, findings: check.findings, source: check.source }, "Output guardrail blocked a reply");
        return {
          ...base,
          status: "blocked",
          reply: BLOCKED_OUTPUT_REPLY,
          toolsRun: [],
          case: caseSummary(),
          ...devGuardrailInfo({
            guardrail: "output",
            reason: check.reason,
            findings: check.findings,
            source: check.source,
            blockedOutput: err.result.agentOutput,
          }),
        };
      }
      if (err instanceof AppError) throw err;
      logger.error({ err, sessionId }, "Troubleshoot agent run failed");
      throw new ServiceUnavailableError("The troubleshoot agent could not respond", { cause: err });
    }
  }

  /** A blocked reply gets one fresh attempt before the customer sees the fallback message. */
  private async runWithRetry(
    sessionId: string,
    runAgent: () => Promise<RunResult<TroubleshootContext, any>>,
    retry: boolean,
  ): Promise<RunResult<TroubleshootContext, any>> {
    try {
      return await runAgent();
    } catch (err) {
      if (!retry || !(err instanceof OutputGuardrailTripwireTriggered)) throw err;
      const check = err.result.output.outputInfo as OutputCheck;
      logger.warn({ sessionId, reason: check.reason, findings: check.findings }, "Reply blocked by output guardrail; retrying once");
      return runAgent();
    }
  }

  /**
   * Lists the checks that actually ran in this request, once each, even when a paused run is resumed.
   * (Counting for the limits happens inside the tool itself.)
   */
  private collectChecksRun(session: Session, result: RunResult<TroubleshootContext, any>, toolsRun: string[]) {
    for (const item of result.newItems) {
      if (item.type !== "tool_call_output_item") continue;
      const raw = item.rawItem as { name?: string; callId?: string };
      if (!raw.callId || session.countedCallIds.has(raw.callId)) continue;
      session.countedCallIds.add(raw.callId);
      // Calls denied by the customer or the policy produce an output item too, but nothing ran.
      if (!isRejectedOutput(item) && raw.name) toolsRun.push(raw.name);
    }
  }

  private ensureConfigured() {
    if (!process.env.OPENAI_API_KEY) {
      throw new ServiceUnavailableError("OPENAI_API_KEY is not configured on the server");
    }
  }
}

function toPendingApproval(item: RunToolApprovalItem): PendingApproval {
  const name = item.name ?? "unknown";
  const def = safeGetTool(name);
  return {
    callId: (item.rawItem as { callId?: string }).callId ?? "",
    tool: name,
    title: def?.title ?? name,
    readOnly: true,
    selfCheck: def?.selfCheck ?? "",
  };
}

function safeGetTool(name: string) {
  try {
    return getTool(name);
  } catch {
    return undefined;
  }
}

function approvalPrompt(approvals: PendingApproval[]): string {
  const titles = approvals.map((a) => a.title).join(", ");
  return `I'd like to run ${approvals.length === 1 ? "this read-only check" : "these read-only checks"}: ${titles}. It only reads information and changes nothing on your laptop. Shall I go ahead?`;
}

/** Our tool outputs are always wrapped JSON with a `source` field; anything else is a rejection message. */
function isRejectedOutput(item: { output?: unknown }): boolean {
  return typeof item.output !== "string" || !item.output.includes('"source":"tier0_diagnostic:');
}

export const troubleshootService = new TroubleshootService(new LocalToolProvider());
