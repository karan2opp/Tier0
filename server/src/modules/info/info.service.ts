import { randomUUID } from "node:crypto";
import {
  InputGuardrailTripwireTriggered,
  OutputGuardrailTripwireTriggered,
  run,
  type Agent,
  type AgentInputItem,
} from "@openai/agents";
import { AppError, logger, ServiceUnavailableError } from "../../common";
import {
  BLOCKED_INPUT_REPLIES,
  BLOCKED_OUTPUT_REPLY,
  devGuardrailInfo,
  type InputCheck,
  type OutputCheck,
} from "../../common/guardrails";
import { redactCredentials } from "../customers/customers.service";
import { createInfoAgent } from "./info.agent";
import type { InfoDecision, InfoReply, InfoSession, SendMessageInput, infoDecisionSchema } from "./info.schema";
import type { InfoContext } from "./info.tools";

const MAX_TURNS = 8;

const LOCKED_REPLY =
  "For your security I can't continue verification here. I'm connecting you with a human agent who can confirm your identity and help you.";

interface Session {
  history: AgentInputItem[];
  state: InfoSession;
}

export class InfoService {
  private readonly agent: Agent<InfoContext, typeof infoDecisionSchema>;
  // In memory for now; moves to the database with the front desk.
  private readonly sessions = new Map<string, Session>();

  constructor() {
    this.agent = createInfoAgent();
  }

  async handleMessage({ sessionId, message }: SendMessageInput): Promise<InfoReply> {
    if (!process.env.OPENAI_API_KEY) {
      throw new ServiceUnavailableError("OPENAI_API_KEY is not configured on the server");
    }

    const id = sessionId ?? randomUUID();
    let session = this.sessions.get(id);
    if (!session) {
      session = {
        history: [],
        state: {
          customerId: null,
          firstName: null,
          failedAttempts: 0,
          locked: false,
          attemptsThisTurn: 0,
          lookupsThisTurn: 0,
          customerMessages: [],
        },
      };
      this.sessions.set(id, session);
    }

    // A new customer message: one more verification attempt allowed, and its details become usable.
    // The original stays on the server (for verification); everything else only sees the redacted text.
    session.state.attemptsThisTurn = 0;
    session.state.lookupsThisTurn = 0;
    session.state.customerMessages.push(message);
    const redacted = redactCredentials(message);

    const base = { sessionId: id, agent: "info" as const };
    const verified = () => Boolean(session.state.customerId);
    const input: AgentInputItem[] = [...session.history, { role: "user", content: redacted }];
    const context: InfoContext = { session: session.state };
    const runOnce = () => run(this.agent, input, { context, maxTurns: MAX_TURNS });

    try {
      let result;
      try {
        result = await runOnce();
      } catch (err) {
        // A blocked reply gets one fresh attempt. Safe: this agent only reads data.
        if (!(err instanceof OutputGuardrailTripwireTriggered)) throw err;
        logger.warn({ sessionId: id, reason: (err.result.output.outputInfo as OutputCheck).reason }, "Reply blocked; retrying once");
        result = await runOnce();
      }

      const toolsRun = result.newItems
        .filter((item) => item.type === "tool_call_output_item")
        .map((item) => (item.rawItem as { name?: string }).name)
        .filter((name): name is string => Boolean(name));

      const raw = result.finalOutput as InfoDecision | undefined;
      if (!raw) throw new ServiceUnavailableError("The info agent returned no decision");

      // Server rule: a locked verification always goes to a human, whatever the model says.
      const decision: InfoDecision = session.state.locked
        ? { reply: LOCKED_REPLY, nextAction: "handoff", handoffTo: "human_agent", handoffReason: "Verification failed too many times" }
        : raw;

      session.history = result.history;
      const handoff =
        decision.nextAction === "handoff" && decision.handoffTo
          ? { to: decision.handoffTo, reason: decision.handoffReason ?? "" }
          : undefined;

      logger.info({ sessionId: id, nextAction: decision.nextAction, handoff: handoff?.to, verified: verified() }, "Info decision");
      const { reply, ...details } = decision;
      return { ...base, status: "completed", reply, verified: verified(), toolsRun, decision: details, handoff };
    } catch (err) {
      if (err instanceof InputGuardrailTripwireTriggered) {
        const check = err.result.output.outputInfo as InputCheck;
        const category = check.category === "none" ? "prompt_injection" : check.category;
        logger.warn({ sessionId: id, category, reason: check.reason }, "Input guardrail blocked a message");
        // A blocked message is forgotten: not in the history, and its details cannot be used for verification.
        session.state.customerMessages.pop();
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
        logger.warn({ sessionId: id, reason: check.reason, findings: check.findings }, "Output guardrail blocked a reply");
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
      logger.error({ err, sessionId: id }, "Info agent run failed");
      throw new ServiceUnavailableError("The info agent could not respond", {
        cause: err,
        ...(process.env.NODE_ENV !== "production" && {
          details: { error: (err as Error)?.name, message: (err as Error)?.message?.slice(0, 300) },
        }),
      });
    }
  }
}

export const infoService = new InfoService();
