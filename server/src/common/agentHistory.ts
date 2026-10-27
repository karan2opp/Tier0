import type { AgentInputItem } from "@openai/agents";

/** The most an agent is sent of the conversation so far. Older turns are dropped. */
const MAX_ITEMS = 40;
/** The most recent tool results are kept in full; older ones are shortened. */
const FULL_TOOL_RESULTS = 2;

const SHORTENED =
  "[Earlier tool result shortened to keep the call fast. Its key points are in your notes, or look it up again if needed.]";

const isMessage = (item: AgentInputItem) => "role" in item;

/**
 * Keeps an agent's history small, so replies stay fast however long the call runs: diagnostic results are large,
 * and every reply would otherwise resend all of them. Drops the oldest turns past a limit (always starting at a
 * message, so no tool result is left without the call that produced it), and shortens all but the latest results.
 */
export function compactHistory(items: AgentInputItem[]): AgentInputItem[] {
  let start = Math.max(0, items.length - MAX_ITEMS);
  while (start < items.length && !isMessage(items[start])) start += 1;
  const kept = start < items.length ? items.slice(start) : items.slice(-MAX_ITEMS);

  let results = 0;
  return kept
    .slice()
    .reverse()
    .map((item) => {
      if (item.type !== "function_call_result") return item;
      results += 1;
      return results > FULL_TOOL_RESULTS ? { ...item, output: SHORTENED } : item;
    })
    .reverse();
}
