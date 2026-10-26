import { randomUUID } from "node:crypto";
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
import { AppError, ConflictError, logger, NotFoundError, ServiceUnavailableError } from "../../common";
import {
  BLOCKED_INPUT_REPLIES,
  BLOCKED_OUTPUT_REPLY,
  devGuardrailInfo,
  type InputCheck,
  type OutputCheck,
} from "../../common/guardrails";
import { redactCredentials } from "../customers/customers.service";
import { forgetLastCustomerMessage, newVerificationState, startCustomerTurn } from "../customers/verification.tool";
import { createStatusAgent } from "./status.agent";
import type {
  PendingChange,
  SendMessageInput,
  StatusDecision,
  StatusReply,
  StatusSession,
  statusDecisionSchema,
} from "./status.schema";
import { asksForChange, whySlotNotChoosable, type StatusContext } from "./status.tools";

const MAX_TURNS = 8;
/** How many times the server may cancel unchosen changes in one request before giving up. */
const MAX_VETO_ROUNDS = 3;

const LOCKED_REPLY =
  "For your security I can't continue verification here. I'm connecting you with a human agent who can confirm your identity and help you.";

const DECLINED_MESSAGE =
  "The customer chose not to make this change, so nothing was saved and the booking stays as it was. " +
  "Acknowledge that it is unchanged and ask what they would prefer instead.";

interface Session {
  history: AgentInputItem[];
  state: StatusSession;
  /** A run paused at a change that needs the customer's confirmation. */
  pending?: RunState<StatusContext, any>;
}

export class StatusService {
  private readonly agent: Agent<StatusContext, typeof statusDecisionSchema>;
  // In memory for now; moves to the database with the front desk.
  private readonly sessions = new Map<string, Session>();

  constructor() {
    this.agent = createStatusAgent();
  }

  async handleMessage({ sessionId, message }: SendMessageInput): Promise<StatusReply> {
    this.ensureConfigured();
    const id = sessionId ?? randomUUID();
    let session = this.sessions.get(id);
    if (!session) {
      session = {
        history: [],
        state: {
          ...newVerificationState(),
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

    // The original stays on the server (for verification); the model and guardrails only see the redacted text.
    startCustomerTurn(session.state, message);
    session.state.turn += 1;
    session.state.customerAskedForChange = asksForChange(message);
    session.state.lookupsThisTurn = 0;
    session.state.slotLookupsThisTurn = 0;
    session.state.changesThisTurn = 0;
    const input: AgentInputItem[] = [...session.history, { role: "user", content: redactCredentials(message) }];
    const context: StatusContext = { session: session.state };

    // Retrying is safe: a change can never be saved before the customer confirms it.
    return this.execute(id, session, () => run(this.agent, input, { context, maxTurns: MAX_TURNS }), true);
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
  ): Promise<StatusReply> {
    const base = { sessionId, agent: "status" as const };
    const verified = () => Boolean(session.state.customerId);

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
            verified: verified(),
            toolsRun: [],
            decision: { nextAction: "ask_question", handoffTo: null, handoffReason: null },
          };
        }
        logger.info({ sessionId, reasons: rejected.map((r) => r.reason) }, "Change request auto-cancelled by policy");
        for (const { item, reason } of rejected) result.state.reject(item, { message: reason });
        result = await run(this.agent, result.state, { maxTurns: MAX_TURNS });
      }

      const toolsRun = result.newItems
        .filter((item) => item.type === "tool_call_output_item")
        .map((item) => (item.rawItem as { name?: string }).name)
        .filter((name): name is string => Boolean(name));

      if (result.interruptions.length > 0) {
        session.pending = result.state;
        const approvals = result.interruptions.map((item) => this.describeChange(session, item));
        const reply = `Just to confirm: ${approvals.map((a) => a.description).join("; ")}. Shall I go ahead?`;
        return { ...base, status: "approval_required", reply, verified: verified(), toolsRun, approvals };
      }

      const raw = result.finalOutput as StatusDecision | undefined;
      if (!raw) throw new ServiceUnavailableError("The status agent returned no decision");

      // Server rule: a locked verification always goes to a human, whatever the model says.
      const decision: StatusDecision = session.state.locked
        ? { reply: LOCKED_REPLY, nextAction: "handoff", handoffTo: "human_agent", handoffReason: "Verification failed too many times" }
        : raw;

      session.history = result.history;
      const handoff =
        decision.nextAction === "handoff" && decision.handoffTo
          ? { to: decision.handoffTo, reason: decision.handoffReason ?? "" }
          : undefined;

      logger.info({ sessionId, nextAction: decision.nextAction, handoff: handoff?.to, verified: verified() }, "Status decision");
      const { reply, ...details } = decision;
      return { ...base, status: "completed", reply, verified: verified(), toolsRun, decision: details, handoff };
    } catch (err) {
      if (err instanceof InputGuardrailTripwireTriggered) {
        const check = err.result.output.outputInfo as InputCheck;
        const category = check.category === "none" ? "prompt_injection" : check.category;
        logger.warn({ sessionId, category, reason: check.reason }, "Input guardrail blocked a message");
        // A blocked message is forgotten: not in the history, and its details cannot be used for verification.
        forgetLastCustomerMessage(session.state);
        return {
          ...base,
          status: "blocked",
          reply: BLOCKED_INPUT_REPLIES[category],
          verified: verified(),
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
          verified: verified(),
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
