/**
 * Deterministic detectors shared by the guardrails. Fast, free, and run before any LLM-based check.
 */

/** Phrases typical of prompt-injection attempts (in customer messages or in machine data). */
export const INJECTION_PATTERNS: RegExp[] = [
  /\b(ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|your|system|developer)\b[^.\n]{0,20}\b(instructions?|prompts?|rules|guidelines|directives)\b/i,
  /\b(reveal|show|print|repeat|output|leak|tell me)\b[^.\n]{0,30}\b(system|hidden|initial|developer|secret)\s+(prompt|instructions?|message|rules)\b/i,
  /\byou are now\b|\bfrom now on,? you (are|will|must)\b/i,
  /\b(developer|god|jailbreak|dan)\s+mode\b/i,
  /<\|?\s*(im_start|im_end|system|endoftext)\s*\|?>|\[\/?INST\]/i,
  /^\s*#{2,}\s*(system|instructions?)\b/im,
  /\bnew (system )?instructions?\s*:/i,
];

/** Data that must never appear in anything we send to the customer or the model. */
export const SECRET_PATTERNS: Array<[name: string, pattern: RegExp]> = [
  ["api_key", /\bsk-[A-Za-z0-9_-]{20,}/],
  ["aws_access_key", /\bAKIA[0-9A-Z]{16}\b/],
  ["private_key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["windows_sid", /\bS-1-5-21(?:-\d+){3,}\b/i],
  ["windows_product_key", /\b[A-Z0-9]{5}(?:-[A-Z0-9]{5}){4}\b/],
];

/** Commands the assistant must never tell a customer to run. */
export const DANGEROUS_COMMAND_PATTERNS: Array<[name: string, pattern: RegExp]> = [
  ["format_drive", /\bformat(\.com)?\s+[a-z]:/i],
  ["diskpart_destructive", /\bdiskpart\b[\s\S]{0,120}\b(clean|delete\s+(partition|volume)|format)\b/i],
  ["recursive_delete", /\b(del|erase)\s+(\/[sqfa]\S*\s*){1,}|\b(rd|rmdir)\s+\/s\b|\brm\s+-(rf|fr)\b|Remove-Item\b[^\n]*-Recurse/i],
  ["registry_edit", /\breg(\.exe)?\s+(delete|add)\b|Remove-ItemProperty\b|Set-ItemProperty\s+[^\n]*HK(LM|CU):/i],
  ["boot_config", /\bbcdedit\b/i],
  ["delete_backups", /\bvssadmin\s+delete\b|\bwmic\s+shadowcopy\s+delete\b|\bwbadmin\s+delete\b/i],
  ["disable_security", /Set-MpPreference\b[^\n]*-Disable|\bnetsh\s+advfirewall\s+set\b[^\n]*\boff\b|Set-ExecutionPolicy\s+(Unrestricted|Bypass)/i],
  ["download_and_run", /\b(iex|Invoke-Expression)\b|\b(curl|wget|iwr|Invoke-WebRequest|irm|Invoke-RestMethod)\b[^\n]*\|\s*(iex|sh|bash|powershell|pwsh)\b/i],
  ["wipe_free_space", /\bcipher\s+\/w\b/i],
];

export function findInjection(text: string): string | null {
  for (const pattern of INJECTION_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

export function findMatches(text: string, patterns: Array<[string, RegExp]>): string[] {
  return patterns.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}
