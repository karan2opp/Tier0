import type { z } from "zod";
import { logger, ValidationError } from "../../../common";
import { runPowerShell } from "../runtime/powershell";
import { getTool } from "../tools/definitions";
import type { ToolProvider } from "./provider";

const elapsed = (startedAt: number) => Math.round(performance.now() - startedAt);

/** Missing parameter keys become null ("use the default"), matching the strict tool schemas. */
function withNullDefaults(schema: z.ZodObject, args: unknown): Record<string, unknown> {
  const defaults = Object.fromEntries(Object.keys(schema.shape).map((key) => [key, null]));
  const given = args && typeof args === "object" && !Array.isArray(args) ? args : {};
  return { ...defaults, ...given };
}

export class LocalToolProvider implements ToolProvider {
  readonly name = "local";

  async run(toolName: string, args?: unknown): Promise<unknown> {
    const tool = getTool(toolName);

    const parsed = tool.parameters.safeParse(withNullDefaults(tool.parameters, args));
    if (!parsed.success) {
      const details = parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
      throw new ValidationError(`Invalid arguments for ${tool.name}`, { details });
    }

    const startedAt = performance.now();
    try {
      const result = await runPowerShell(tool.buildScript(parsed.data), { label: tool.name, timeoutMs: tool.timeoutMs });
      logger.info({ tool: tool.name, provider: this.name, durationMs: elapsed(startedAt) }, "Tool succeeded");
      return result;
    } catch (err) {
      logger.warn({ tool: tool.name, provider: this.name, durationMs: elapsed(startedAt) }, "Tool failed");
      throw err;
    }
  }
}
