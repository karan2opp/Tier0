import { execFile } from "node:child_process";
import { logger, ServiceUnavailableError } from "../../../common";
import { scrub } from "./scrub";

// Prepended to every script: fail fast, no progress noise on stderr, UTF-8 output.
const PRELUDE = [
  "$ErrorActionPreference = 'Stop'",
  "$ProgressPreference = 'SilentlyContinue'",
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
].join("\n");

export interface PowerShellOptions {
  /** Used in logs and error messages, e.g. the tool name. */
  label: string;
  timeoutMs?: number;
}

/**
 * Runs one of OUR fixed scripts (never model-written text) and returns its JSON output.
 * -EncodedCommand avoids every quoting/escaping problem of passing scripts on the command line.
 */
export function runPowerShell(script: string, { label, timeoutMs = 20_000 }: PowerShellOptions): Promise<unknown> {
  if (process.platform !== "win32") {
    return Promise.reject(new ServiceUnavailableError("Local diagnostics are only available on Windows"));
  }

  const encoded = Buffer.from(`${PRELUDE}\n${script}`, "utf16le").toString("base64");

  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 5 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const timedOut = err.killed === true;
          logger.error({ tool: label, timedOut, stderr: (stderr || err.message).slice(0, 1000) }, "PowerShell diagnostic failed");
          return reject(
            new ServiceUnavailableError(`Diagnostic "${label}" ${timedOut ? "timed out" : "failed"}`, { cause: err }),
          );
        }

        const text = stdout.trim();
        if (!text) return resolve(null);

        try {
          resolve(scrub(JSON.parse(text)));
        } catch (parseErr) {
          logger.error({ tool: label, output: text.slice(0, 500) }, "PowerShell diagnostic returned non-JSON output");
          reject(new ServiceUnavailableError(`Diagnostic "${label}" returned unreadable output`, { cause: parseErr }));
        }
      },
    );
  });
}
