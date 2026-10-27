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
  ForbiddenError,
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
import type { VerificationState } from "../customers/verification.tool";
import { createStatusAgent } from "./status.agent";
import type {
  PendingChange,
  StatusDecision,
  StatusReply,
  StatusSession,
  statusDecisionSchema,
} from "./status.schema";
import { asksForChange, whySlotNotChoosable, type StatusContext } from "./status.tools";

const MAX_TURNS = 8;
/** How many times the server may cancel unchosen changes in one request before giving up. */
const MAX_VETO_ROUNDS = 3;

const DECLINED_MESSAGE =
  "The customer chose not to make this change, so nothing was saved and the booking stays as it was. " +
  "Acknowledge that it is unchanged and ask what they would prefer instead.";

export interface StatusInput {
  sessionId: string;
  /** The customer's message, already redacted. */
  message: string;
  /** The conversation's identity; the customer must already be verified by the front desk. */
  identity: VerificationState;
  /** What happened before this agent took over (or since it last spoke), added before the message. */
  briefing?: AgentInputItem[];
  /** Aborted when the customer adds to their message before this answer is ready. */
  signal?: AbortSignal;
}

interface Session {
  history: AgentInputItem[];
  state: StatusSession;
  /** A run paused at a change that needs the customer's confirmation. */
  pending?: RunState<StatusContext, any>;
}

export class StatusService {
  private readonly agent: Agent<StatusContext, typeof statusDecisionSchema>;
  // Keyed by this agent's session id within a conversation; in memory for now.
  private readonly sessions = new Map<string, Session>();

  constructor() {
    this.agent = createStatusAgent();
  }

  async handleMessage({ sessionId: id, message, identity, briefing = [], signal }: StatusInput): Promise<StatusReply> {
    this.ensureConfigured();
    // Repairs are account data: the front desk must have verified the customer first.
    if (!identity.customerId) throw new ForbiddenError("The customer must be verified before checking repairs");
    let session = this.sessions.get(id);
    if (!session) {
      session = {
        history: [],
        state: {
          identity,
          turn: 0,
          customerAskedForChange: false,
          lookupsThisTurn: 0,
          slotLookupsThisTurn: 0,
          changesThisTurn: 0,
          offeredSlots: {},
          slotCounter: 0,
        },
      };
      this.sessions.set(id, session);
    }

    if (session.pending) {
      throw new ConflictError("Please confirm or cancel the pending change first", {
        details: { approvals: session.pending.getInterruptions().map((item) => this.describeChange(session!, item)) },
      });
    }

    session.state.turn += 1;
    session.state.customerAskedForChange = asksForChange(message);
    session.state.lookupsThisTurn = 0;
    session.state.slotLookupsThisTurn = 0;
    session.state.changesThisTurn = 0;
    const input: AgentInputItem[] = [...compactHistory(session.history), ...briefing, { role: "user", content: message }];
    const context: StatusContext = { session: session.state };

    // Retrying is safe: a change can never be saved before the customer confirms it.
    return this.execute(id, session, () => run(this.agent, input, { context, maxTurns: MAX_TURNS, signal }), true, signal);
  }

  async handleApproval(sessionId: string, approve: boolean): Promise<StatusReply> {
    this.ensureConfigured();
    const session = this.sessions.get(sessionId);
    if (!session?.pending) throw new NotFoundError("There is no change waiting for confirmation in this session");

    const state = session.pending;
    session.pending = undefined;
    const items = state.getInterruptions();
    for (const item of items) {
      if (approve) state.approve(item);
      else state.reject(item, { message: DECLINED_MESSAGE });
    }
    // After a decline, no new change may be proposed until the customer says what they want instead.
    if (!approve) session.state.changesThisTurn += 1;
    logger.info({ sessionId, approve, changes: items.length }, "Customer decided on a change");

    return this.execute(sessionId, session, () => run(this.agent, state, { maxTurns: MAX_TURNS }), false);
  }

  private async execute(
    sessionId: string,
    session: Session,
    runAgent: () => Promise<RunResult<StatusContext, any>>,
    retryBlockedOutput: boolean,
    signal?: AbortSignal,
  ): Promise<StatusReply> {
    const base = { sessionId, agent: "status" as const };

    try {
      let result: RunResult<StatusContext, any>;
      try {
        result = await runAgent();
      } catch (err) {
        if (!retryBlockedOutput || !(err instanceof OutputGuardrailTripwireTriggered)) throw err;
        logger.warn({ sessionId, reason: (err.result.output.outputInfo as OutputCheck).reason }, "Reply blocked; retrying once");
        result = await runAgent();
      }

      // Server gate: a change the customer did not choose is cancelled before they are ever asked to confirm it.
      for (let round = 0; result.interruptions.length > 0; round++) {
        const rejected = result.interruptions
          .map((item) => ({ item, reason: whySlotNotChoosable(session.state, slotIdOf(item)) }))
          .filter((entry): entry is { item: RunToolApprovalItem; reason: string } => entry.reason !== null);
        if (rejected.length === 0) break;
        if (round >= MAX_VETO_ROUNDS) {
          // Give up on this proposal without changing anything, and simply ask the customer to choose.
          logger.warn({ sessionId }, "Agent kept proposing changes the customer did not choose; asking the customer instead");
          return {
            ...base,
            status: "completed",
            reply: "Which day and time would suit you best? I'll check what's available and confirm it with you.",
            toolsRun: [],
            decision: { nextAction: "ask_question", handoffTo: null, handoffReason: null },
          };
        }
        logger.info({ sessionId, reasons: rejected.map((r) => r.reason) }, "Change request auto-cancelled by policy");
        for (const { item, reason } of rejected) result.state.reject(item, { message: reason });
        result = await run(this.agent, result.state, { maxTurns: MAX_TURNS, signal });
      }

      const toolsRun = result.newItems
        .filter((item) => item.type === "tool_call_output_item")
        .map((item) => (item.rawItem as { name?: string }).name)
        .filter((name): name is string => Boolean(name));

      if (result.interruptions.length > 0) {
        session.pending = result.state;
        const approvals = result.interruptions.map((item) => this.describeChange(session, item));
        const reply = `Just to confirm: ${approvals.map((a) => a.description).join("; ")}. Shall I go ahead?`;
        return { ...base, status: "approval_required", reply, toolsRun, approvals };
      }

      const decision = result.finalOutput as StatusDecision | undefined;
      if (!decision) throw new ServiceUnavailableError("The status agent returned no decision");

      session.history = result.history;
      const handoff =
        decision.nextAction === "handoff" && decision.handoffTo
          ? { to: decision.handoffTo, reason: decision.handoffReason ?? "" }
          : undefined;

      logger.info({ sessionId, nextAction: decision.nextAction, handoff: handoff?.to }, "Status decision");
      const { reply, ...details } = decision;
      return { ...base, status: "completed", reply, toolsRun, decision: details, handoff };
    } catch (err) {
      if (signal?.aborted) {
        // Dropped for a newer message. Slots offered in this run were never shown to the customer,
        // so they must not count as "seen" (and choosable) later. Nothing can have been saved without approval.
        const { state } = session;
        for (const [slotId, slot] of Object.entries(state.offeredSlots)) {
          if (slot.offeredInTurn === state.turn) delete state.offeredSlots[slotId];
        }
        throw new SupersededError();
      }
      if (err instanceof InputGuardrailTripwireTriggered) {
        const check = err.result.output.outputInfo as InputCheck;
        const category = check.category === "none" ? "prompt_injection" : check.category;
        logger.warn({ sessionId, category, reason: check.reason }, "Input guardrail blocked a message");
        // The blocked message is not added to the history.
        return {
          ...base,
          status: "blocked",
          reply: BLOCKED_INPUT_REPLIES[category],
          toolsRun: [],
          ...devGuardrailInfo({ guardrail: "input", category, reason: check.reason, source: check.source }),
        };
      }
      if (err instanceof OutputGuardrailTripwireTriggered) {
        const check = err.result.output.outputInfo as OutputCheck;
        logger.warn({ sessionId, reason: check.reason, findings: check.findings }, "Output guardrail blocked a reply");
        return {
          ...base,
          status: "blocked",
          reply: BLOCKED_OUTPUT_REPLY,
          toolsRun: [],
          ...devGuardrailInfo({ guardrail: "output", reason: check.reason, findings: check.findings, blockedOutput: err.result.agentOutput }),
        };
      }
      if (err instanceof AppError) throw err;
      logger.error({ err, sessionId }, "Status agent run failed");
      throw new ServiceUnavailableError("The status agent could not respond", {
        cause: err,
        ...(process.env.NODE_ENV !== "production" && {
          details: { error: (err as Error)?.name, message: (err as Error)?.message?.slice(0, 300) },
        }),
      });
    }
  }

  /** Plain description of a pending change, built from the server's own record of offered slots. */
  private describeChange(session: Session, item: RunToolApprovalItem): PendingChange {
    const slot = session.state.offeredSlots[slotIdOf(item)];
    return {
      callId: (item.rawItem as { callId?: string }).callId ?? "",
      action: "reschedule_visit",
      description: slot
        ? `move the ${slot.kind} for ticket ${slot.ticketNumber} to ${slot.label}`
        : "make a change to your booking",
    };
  }

  private ensureConfigured() {
    if (!process.env.OPENAI_API_KEY) {
      throw new ServiceUnavailableError("OPENAI_API_KEY is not configured on the server");
    }
  }
}

/** The slot id a reschedule_visit request refers to ("" if unreadable; then it is rejected as unknown). */
function slotIdOf(item: RunToolApprovalItem): string {
  try {
    return String((JSON.parse(item.arguments ?? "{}") as { slotId?: string }).slotId ?? "").trim().toUpperCase();
  } catch {
    return "";
  }
}

export const statusService = new StatusService();
