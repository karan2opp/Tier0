const HESITATIONS = new Set(["uh", "um", "umm", "uhh", "hmm", "hm", "mm", "mmm", "mhm", "ah", "oh", "er", "erm", "huh"]);

/** What speech transcribers tend to invent from background noise or silence. */
const HALLUCINATIONS = /^(thanks for watching|you|bye|so)[.!?]*$/i;

const wordsOf = (text: string) => text.toLowerCase().match(/[a-z0-9'-]+/g) ?? [];

/** A transcript that is only noise: nothing, hesitations ("um", "mm"), or a phrase invented from background sound. */
export function isNoise(text: string): boolean {
  const real = wordsOf(text).filter((w) => !HESITATIONS.has(w));
  return real.length === 0 || HALLUCINATIONS.test(text.trim());
}
