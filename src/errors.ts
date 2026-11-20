/** Turns Workers AI and network failures into one short, actionable sentence. */
export function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/429|rate.?limit|too many requests|3040|capacity/i.test(msg)) {
    return "Workers AI is rate limited or at capacity. Wait a few seconds and send the message again.";
  }
  if (/context|too many tokens|maximum.*length|5006/i.test(msg)) {
    return "That input is too large for the model. Paste a smaller excerpt (the failing pod's describe output and the last 50 log lines).";
  }
  if (/timeout|timed out|aborted/i.test(msg)) {
    return "The model took too long to answer. Try again.";
  }
  return "Something went wrong talking to the model. Try again; if it keeps happening, check the Worker logs.";
}
