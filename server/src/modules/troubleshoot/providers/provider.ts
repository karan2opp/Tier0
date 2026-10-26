/**
 * Where tool calls are executed. Today: `local` (this machine via PowerShell).
 * Later: `simulated` (scenario files) and `remote` (helper over WebSocket).
 */
export interface ToolProvider {
  readonly name: string;
  run(toolName: string, args?: unknown): Promise<unknown>;
}
