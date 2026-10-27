import { useCallback, useRef, useState } from "react";
import {
  api,
  ApiError,
  isCheckApproval,
  type AgentMessage,
  type AgentName,
  type ApprovalItem,
  type ConversationReply,
  type ConversationStatus,
  type Customer,
  type Escalation,
  type Handoff,
  type TroubleshootDecision,
} from "../api";
import { toolLabel } from "../agents";

export type Entry =
  | { id: number; kind: "customer"; text: string; private: boolean }
  | {
      id: number;
      kind: "agent";
      agent: AgentName;
      text: string;
      blocked: boolean;
      index?: number;
      /** The customer talked over this line. */
      interrupted?: boolean;
      /** Never read aloud: the customer was already talking. */
      unspoken?: boolean;
    }
  | { id: number; kind: "handoff"; from: AgentName; to: AgentName; reason: string }
  | { id: number; kind: "notice"; text: string; tone: "info" | "error" };

export type Approval = { agent: AgentName; items: ApprovalItem[] };

export interface ConversationState {
  sessionId: string | null;
  status: ConversationStatus | "idle";
  activeAgent: AgentName;
  entries: Entry[];
  verified: boolean;
  customer: Customer | null;
  /** Shown once the agent has finished asking for it, not when the server replies. */
  approval: Approval | null;
  toolsRun: { agent: AgentName; tool: string }[];
  handoffs: Handoff[];
  diagnosis: TroubleshootDecision | null;
  escalation: Escalation | null;
  startedAt: number | null;
}

/** One line of a reply, with what appears in the transcript when it is spoken (the line, then any transfer marker). */
export interface Segment {
  message: AgentMessage;
  entries: Entry[];
}

/** A reply ready to be played: its lines in order, and the approval card to show after them. */
export interface Delivery {
  reply: ConversationReply;
  segments: Segment[];
  approval: Approval | null;
}

const INITIAL: ConversationState = {
  sessionId: null,
  status: "idle",
  activeAgent: "front_desk",
  entries: [],
  verified: false,
  customer: null,
  approval: null,
  toolsRun: [],
  handoffs: [],
  diagnosis: null,
  escalation: null,
  startedAt: null,
};

/** Phone numbers and serial numbers: the server hides these from every agent, and we say so in the transcript. */
const CREDENTIALS = /(\+?\d[\d\s-]{8,18}\d)|\b(?=[a-z0-9-]*\d)(?=[a-z0-9-]*[a-z])[a-z0-9-]{8,24}\b/i;

export function useConversation() {
  const [state, setState] = useState<ConversationState>(INITIAL);
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);
  const id = () => nextId.current++;

  /** Adds lines to the transcript (the call screen does this as each line is spoken). */
  const reveal = useCallback((entries: Entry[]) => {
    if (entries.length) setState((s) => ({ ...s, entries: [...s.entries, ...entries] }));
  }, []);

  /** Shows the approval card, once the agent has finished asking. */
  const revealApproval = useCallback((approval: Approval | null) => {
    setState((s) => ({ ...s, approval }));
  }, []);

  /** Splits a reply into lines, each with its transcript entries (a transfer marker follows the line that transferred). */
  const toSegments = (reply: ConversationReply): Segment[] => {
    const handoffs = [...reply.handoffs];
    return reply.messages.map((message, i) => {
      const entries: Entry[] = [
        {
          id: id(),
          kind: "agent",
          agent: message.agent,
          text: message.text,
          index: message.index,
          blocked: reply.status === "blocked" && i === reply.messages.length - 1,
        },
      ];
      const at = handoffs.findIndex((h) => h.from === message.agent);
      if (at >= 0) {
        const [handoff] = handoffs.splice(at, 1);
        entries.push({ id: id(), kind: "handoff", from: handoff.from, to: handoff.to, reason: handoff.reason });
      }
      return { message, entries };
    });
  };

  /** Applies everything except what is said: lines and the approval card wait until they are spoken. */
  const apply = useCallback((reply: ConversationReply): Delivery => {
    const latestDiagnosis = [...reply.decisions].reverse().find((d) => d.agent === "troubleshoot")?.decision as
      | TroubleshootDecision
      | undefined;
    setState((s) => ({
      ...s,
      sessionId: reply.sessionId,
      status: reply.status,
      activeAgent: reply.activeAgent,
      verified: reply.verified,
      customer: reply.customer,
      toolsRun: [...s.toolsRun, ...reply.toolsRun],
      handoffs: [...s.handoffs, ...reply.handoffs],
      diagnosis: latestDiagnosis ?? s.diagnosis,
      escalation: reply.escalation ?? s.escalation,
      startedAt: s.startedAt ?? Date.now(),
    }));
    return { reply, segments: toSegments(reply), approval: reply.approval ?? null };
  }, []);

  const fail = useCallback(
    (err: unknown) => {
      const text = err instanceof ApiError ? err.message : "Something went wrong. Please try again.";
      reveal([{ id: id(), kind: "notice", text, tone: "error" }]);
    },
    [reveal],
  );

  const start = useCallback(async (): Promise<Delivery | null> => {
    nextId.current = 1;
    setState(INITIAL);
    setBusy(true);
    try {
      return apply(await api.start());
    } catch (err) {
      fail(err);
      return null;
    } finally {
      setBusy(false);
    }
  }, [apply, fail]);

  /** Messages sent but not answered yet. */
  const sending = useRef(0);

  /**
   * Sends a message, even while the last one is still being answered: the server then answers both together,
   * and the reply to the earlier one comes back "superseded" and is ignored here.
   */
  const send = useCallback(
    async (text: string, interrupted = false): Promise<Delivery | null> => {
      const message = text.trim();
      if (!message || !state.sessionId) return null;
      reveal([{ id: id(), kind: "customer", text: message, private: CREDENTIALS.test(message) }]);
      sending.current += 1;
      setBusy(true);
      try {
        const reply = await api.send(state.sessionId, message, interrupted);
        if (reply.status === "superseded") return null;
        return apply(reply);
      } catch (err) {
        fail(err);
        return null;
      } finally {
        sending.current -= 1;
        if (sending.current === 0) setBusy(false);
      }
    },
    [state.sessionId, reveal, apply, fail],
  );

  /** Answers the pending check or change. `approval` is passed when its card is not on screen yet. */
  const answer = useCallback(
    async (approve: boolean, approval?: Approval): Promise<Delivery | null> => {
      const pending = approval ?? state.approval;
      if (!pending || !state.sessionId || busy) return null;
      const what = pending.items
        .map((item) => (isCheckApproval(item) ? toolLabel(item.tool) : "the change"))
        .join(", ");
      reveal([{ id: id(), kind: "notice", text: `${approve ? "You allowed" : "You declined"}: ${what}`, tone: "info" }]);
      setState((s) => ({ ...s, approval: null }));
      setBusy(true);
      try {
        return apply(await api.answer(state.sessionId, approve));
      } catch (err) {
        fail(err);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [state.approval, state.sessionId, busy, reveal, apply, fail],
  );

  const reset = useCallback(() => setState(INITIAL), []);

  /** Flags an agent line that was cut off ("interrupted") or never read aloud ("unspoken"). */
  const markLine = useCallback((message: AgentMessage, flag: "interrupted" | "unspoken") => {
    setState((s) => ({
      ...s,
      entries: s.entries.map((e) =>
        e.kind === "agent" && (message.index !== undefined ? e.index === message.index : e.text === message.text)
          ? { ...e, [flag]: true }
          : e,
      ),
    }));
  }, []);

  return { state, busy, start, send, answer, reset, reveal, revealApproval, markLine };
}
