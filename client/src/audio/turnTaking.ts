/** How long a pause ends the customer's turn. */
export const END_OF_TURN_MS = 1200;
/** A longer pause allowed when the sentence clearly is not finished ("...and", "...because", "um"). */
export const UNFINISHED_PAUSE_MS = 2200;

const TRAILING_CONNECTOR =
  /\b(and|but|so|or|because|also|plus|then|like|with|the|a|an|my|to|of|for|is|it's|if|when|that|um+|uh+|er+|hmm+)\s*[.,…-]*\s*$/i;

/** Whether the customer stopped mid-sentence, so we should wait a little longer before answering. */
export function isUnfinished(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && (TRAILING_CONNECTOR.test(trimmed) || /[,…-]\s*$/.test(trimmed));
}
