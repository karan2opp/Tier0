/** Small helpers for safely reading tool output, which is untyped JSON from PowerShell. */

export type Reading = Record<string, unknown>;

export const asRecord = (value: unknown): Reading | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Reading) : null;

export const asList = (value: unknown): Reading[] =>
  Array.isArray(value) ? value.map(asRecord).filter((item): item is Reading => item !== null) : [];
