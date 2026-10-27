import { useCallback, useRef, useState } from "react";
import {
  api,
  ApiError,
  isCheckApproval,
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
  | { id: number; kind: "agent"; agent: AgentName; text: string; blocked: boolean; index?: number; interrupted?: boolean }
  | { id: number; kind: "handoff"; from: AgentName; to: AgentName; reason: string }
  | { id: number; kind: "notice"; text: string; tone: "info" | "error" };

export interface ConversationState {
  sessionId: string | null;
  status: ConversationStatus | "idle";
  activeAgent: AgentName;
  entries: Entry[];
  verified: boolean;
  customer: Customer | null;
  approval: { agent: AgentName; items: ApprovalItem[] } | null;
  toolsRun: { agent: AgentName; tool: string }[];
  handoffs: Handoff[];
  diagnosis: TroubleshootDecision | null;
  escalation: Escalation | null;
  startedAt: number | null;
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

  const addEntries = useCallback((entries: Entry[]) => {
    setState((s) => ({ ...s, entries: [...s.entries, ...entries] }));
  }, []);

  /** Agent messages in order, with a transfer marker after the message that handed the call on. */
  const toEntries = (reply: ConversationReply): Entry[] => {
    const entries: Entry[] = [];
    const handoffs = [...reply.handoffs];
    for (const message of reply.messages) {
      entries.push({
        id: id(),
        kind: "agent",
        agent: message.agent,
        text: message.text,
        index: message.index,
        blocked: reply.status === "blocked" && message === reply.messages[reply.messages.length - 1],
      });
      const index = handoffs.findIndex((h) => h.from === message.agent);
      if (index >= 0) {
        const [handoff] = handoffs.splice(index, 1);
        entries.push({ id: id(), kind: "handoff", from: handoff.from, to: handoff.to, reason: handoff.reason });
      }
    }
    return entries;
  };

  const apply = useCallback((reply: ConversationReply) => {
    const latestDiagnosis = [...reply.decisions].reverse().find((d) => d.agent === "troubleshoot")?.decision as
      | TroubleshootDecision
      | undefined;
    const entries = toEntries(reply);
    setState((s) => ({
      ...s,
      sessionId: reply.sessionId,
      status: reply.status,
      activeAgent: reply.activeAgent,
      entries: [...s.entries, ...entries],
      verified: reply.verified,
      customer: reply.customer,
      approval: reply.approval ?? null,
      toolsRun: [...s.toolsRun, ...reply.toolsRun],
      handoffs: [...s.handoffs, ...reply.handoffs],
      diagnosis: latestDiagnosis ?? s.diagnosis,
      escalation: reply.escalation ?? s.escalation,
      startedAt: s.startedAt ?? Date.now(),
    }));
  }, []);

  const fail = useCallback(
    (err: unknown) => {
      const text = err instanceof ApiError ? err.message : "Something went wrong. Please try again.";
      addEntries([{ id: id(), kind: "notice", text, tone: "error" }]);
    },
    [addEntries],
  );

  const start = useCallback(async (): Promise<ConversationReply | null> => {
    nextId.current = 1;
    setState(INITIAL);
    setBusy(true);
    try {
      const reply = await api.start();
      apply(reply);
      return reply;
    } catch (err) {
      fail(err);
      return null;
    } finally {
      setBusy(false);
    }
  }, [apply, fail]);

  const send = useCallback(
    async (text: string, interrupted = false): Promise<ConversationReply | null> => {
      const message = text.trim();
      if (!message || !state.sessionId || busy) return null;
      addEntries([{ id: id(), kind: "customer", text: message, private: CREDENTIALS.test(message) }]);
      setBusy(true);
      try {
        const reply = await api.send(state.sessionId, message, interrupted);
        apply(reply);
        return reply;
      } catch (err) {
        fail(err);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [state.sessionId, busy, addEntries, apply, fail],
  );

  const answer = useCallback(
    async (approve: boolean): Promise<ConversationReply | null> => {
      const pending = state.approval;
      if (!pending || !state.sessionId || busy) return null;
      const what = pending.items
        .map((item) => (isCheckApproval(item) ? toolLabel(item.tool) : "the change"))
        .join(", ");
      addEntries([{ id: id(), kind: "notice", text: `${approve ? "You allowed" : "You declined"}: ${what}`, tone: "info" }]);
      setState((s) => ({ ...s, approval: null }));
      setBusy(true);
      try {
        const reply = await api.answer(state.sessionId, approve);
        apply(reply);
        return reply;
      } catch (err) {
        fail(err);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [state.approval, state.sessionId, busy, addEntries, apply, fail],
  );

  const reset = useCallback(() => setState(INITIAL), []);

  /** Marks an agent line the customer talked over. */
  const markInterrupted = useCallback((index: number | undefined, text: string) => {
    setState((s) => ({
      ...s,
      entries: s.entries.map((e) =>
        e.kind === "agent" && (index !== undefined ? e.index === index : e.text === text) ? { ...e, interrupted: true } : e,
      ),
    }));
  }, []);

  return { state, busy, start, send, answer, reset, markInterrupted };
}
