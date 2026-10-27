import {
  InputGuardrailTripwireTriggered,
  OutputGuardrailTripwireTriggered,
  run,
  type Agent,
  type AgentInputItem,
} from "@openai/agents";
import { AppError, logger, ServiceUnavailableError, SupersededError } from "../../common";
import {
  BLOCKED_INPUT_REPLIES,
  BLOCKED_OUTPUT_REPLY,
  devGuardrailInfo,
  type InputCheck,
  type OutputCheck,
} from "../../common/guardrails";
import type { VerificationState } from "../customers/verification.tool";
import { createFrontDeskAgent } from "./frontdesk.agent";
import type { FrontDeskDecision, FrontDeskHandoffTarget, frontDeskDecisionSchema } from "./frontdesk.schema";
import type { FrontDeskContext } from "./frontdesk.tools";

const MAX_TURNS = 8;

export const GREETING =
  "Hi, welcome to Tier0 laptop support. I can help with a problem on your laptop, your warranty, or a repair " +
  "that's already with us. What can I help you with today?";

const LOCKED_REPLY =
  "For your security I can't continue verification here. I'm connecting you with a human agent who can confirm your identity and help you.";

const VERIFY_FIRST_REPLY =
  "Before I connect you, I need to confirm it's you. Could you tell me your registered phone number and the " +
  "serial number from the sticker under your laptop?";

export interface FrontDeskInput {
  sessionId: string;
  /** The customer's message, already redacted. */
  message: string;
  identity: VerificationState;
  /** What happened since the front desk last spoke (e.g. a specialist's conversation), added before the message. */
  briefing?: AgentInputItem[];
  /** Aborted when the customer adds to their message before this answer is ready. */
  signal?: AbortSignal;
}

export interface FrontDeskReply {
  agent: "front_desk";
  status: "completed" | "blocked";
  reply: string;
  toolsRun: string[];
  decision?: Omit<FrontDeskDecision, "reply">;
  handoff?: { to: FrontDeskHandoffTarget; reason: string };
  debug?: Record<string, unknown>;
}

export class FrontDeskService {
  private readonly agent: Agent<FrontDeskContext, typeof frontDeskDecisionSchema>;
  // Keyed by conversation id; in memory for now.
  private readonly histories = new Map<string, AgentInputItem[]>();

  constructor() {
    this.agent = createFrontDeskAgent();
  }

  async handleMessage({ sessionId, message, identity, briefing = [], signal }: FrontDeskInput): Promise<FrontDeskReply> {
    const base = { agent: "front_desk" as const };
    const history = this.histories.get(sessionId) ?? [];
    const input: AgentInputItem[] = [...history, ...briefing, { role: "user", content: message }];
    const context: FrontDeskContext = { session: identity, turn: { lookups: 0 } };
    const runOnce = () => run(this.agent, input, { context, maxTurns: MAX_TURNS, signal });

    try {
      let result;
      try {
        result = await runOnce();
      } catch (err) {
        // A blocked reply gets one fresh attempt. Safe: the front desk only reads data.
        if (!(err instanceof OutputGuardrailTripwireTriggered)) throw err;
        logger.warn({ sessionId, reason: (err.result.output.outputInfo as OutputCheck).reason }, "Reply blocked; retrying once");
        context.turn.lookups = 0;
        result = await runOnce();
      }

      const toolsRun = result.newItems
        .filter((item) => item.type === "tool_call_output_item")
        .map((item) => (item.rawItem as { name?: string }).name)
        .filter((name): name is string => Boolean(name));

      const raw = result.finalOutput as FrontDeskDecision | undefined;
      if (!raw) throw new ServiceUnavailableError("The front desk returned no decision");

      const decision = applyServerRules(raw, identity);
      this.histories.set(sessionId, result.history);
      const handoff =
        decision.nextAction === "handoff" && decision.handoffTo
          ? { to: decision.handoffTo, reason: decision.handoffReason ?? "" }
          : undefined;

      logger.info({ sessionId, nextAction: decision.nextAction, handoff: handoff?.to, verified: Boolean(identity.customerId) }, "Front desk decision");
      const { reply, ...details } = decision;
      return { ...base, status: "completed", reply, toolsRun, decision: details, handoff };
    } catch (err) {
      // Dropped for a newer message: nothing was saved, so the next run starts clean.
      if (signal?.aborted) throw new SupersededError();
      if (err instanceof InputGuardrailTripwireTriggered) {
        const check = err.result.output.outputInfo as InputCheck;
        const category = check.category === "none" ? "prompt_injection" : check.category;
        logger.warn({ sessionId, category, reason: check.reason }, "Input guardrail blocked a message");
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
      logger.error({ err, sessionId }, "Front desk run failed");
      throw new ServiceUnavailableError("The front desk could not respond", {
        cause: err,
        ...(process.env.NODE_ENV !== "production" && {
          details: { error: (err as Error)?.name, message: (err as Error)?.message?.slice(0, 300) },
        }),
      });
    }
  }
}

/** Rules the server enforces whatever the model decides. */
function applyServerRules(decision: FrontDeskDecision, identity: VerificationState): FrontDeskDecision {
  if (identity.locked) {
    return { reply: LOCKED_REPLY, nextAction: "handoff", handoffTo: "human_agent", handoffReason: "Verification failed too many times" };
  }
  // Specialists read account data, so nobody reaches them unverified.
  if (decision.nextAction === "handoff" && decision.handoffTo !== "human_agent" && !identity.customerId) {
    return { reply: VERIFY_FIRST_REPLY, nextAction: "ask_question", handoffTo: null, handoffReason: null };
  }
  return decision;
}

export const frontDeskService = new FrontDeskService();
