/**
 * Llama 3.3 on Workers AI has a ~24k token context window. Keep pasted logs
 * well under that, and only send recent history.
 */
export const MAX_TEXT_CHARS = 12_000;
export const MAX_HISTORY_MESSAGES = 20;

/** Shortens long text by dropping the middle, keeping the head and the tail. */
export function truncateMiddle(text: string, max = MAX_TEXT_CHARS): string {
  if (text.length <= max) return text;
  const half = Math.floor(max / 2);
  const dropped = text.length - half * 2;
  return `${text.slice(0, half)}\n\n[... ${dropped} characters truncated from the middle to fit the model context ...]\n\n${text.slice(-half)}`;
}
