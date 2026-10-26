import {
  defineToolInputGuardrail,
  defineToolOutputGuardrail,
  ToolGuardrailFunctionOutputFactory as Decision,
} from "@openai/agents";
import { findMatches, SECRET_PATTERNS } from "./patterns";

const MAX_TOOL_ARGUMENT_LENGTH = 1_000;

/** Defense in depth on top of the SDK: only listed tools, with small argument payloads. */
export function createToolAllowlistGuardrail(allowedTools: Iterable<string>) {
  const allowed = new Set(allowedTools);
  return defineToolInputGuardrail({
    name: "tool_allowlist",
    run: async ({ toolCall }) => {
      if (!allowed.has(toolCall.name)) {
        return Decision.rejectContent(`The tool "${toolCall.name}" is not available.`);
      }
      if ((toolCall.arguments ?? "").length > MAX_TOOL_ARGUMENT_LENGTH) {
        return Decision.rejectContent("Tool arguments are too large.");
      }
      return Decision.allow();
    },
  });
}

/** Withholds tool output that still contains secrets after scrubbing, instead of passing it to the model. */
export const toolOutputSecretsGuardrail = defineToolOutputGuardrail({
  name: "tool_output_secrets",
  run: async ({ output }) => {
    const text = typeof output === "string" ? output : JSON.stringify(output);
    const secrets = findMatches(text, SECRET_PATTERNS);
    if (secrets.length > 0) {
      return Decision.rejectContent(
        "This check returned data that cannot be shared. Tell the customer the check could not be completed and offer a human engineer.",
        { secrets },
      );
    }
    return Decision.allow();
  },
});
