import {
  INITIAL_STATE,
  type KubePilotState,
  type TimelineEntry,
  type TimelineKind
} from "./types";

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Evidence must be something the user actually said. If the text does not
 * appear in any user message, it is the model's own words, so we store it as
 * a hypothesis instead of letting it pose as a fact.
 */
export function resolveKind(
  requested: TimelineKind,
  text: string,
  userTexts: string[]
): TimelineKind {
  if (requested !== "evidence") return requested;
  const needle = normalize(text);
  return userTexts.some((u) => normalize(u).includes(needle))
    ? "evidence"
    : "hypothesis";
}

const LABEL: Record<TimelineKind, string> = {
  evidence: "evidence",
  hypothesis: "hypothesis (unconfirmed)",
  action: "action",
  note: "note"
};

/** Renders the newest entries that fit in `maxChars`, oldest first. */
export function formatTimeline(
  entries: TimelineEntry[],
  maxChars = 1500
): string[] {
  const lines: string[] = [];
  let used = 0;
  for (const e of [...entries].reverse()) {
    const text = e.text.length > 200 ? `${e.text.slice(0, 200)}…` : e.text;
    const line = `- [${LABEL[e.kind]}] ${text}`;
    if (used + line.length > maxChars) break;
    lines.unshift(line);
    used += line.length;
  }
  return lines;
}

/**
 * State persisted by an older version lacks newer fields. Fill them in from
 * the defaults so every reader can rely on the current shape.
 */
export function normalizeState(
  saved: Partial<KubePilotState> | undefined
): KubePilotState {
  return {
    ...INITIAL_STATE,
    ...saved,
    cluster: { ...INITIAL_STATE.cluster, ...saved?.cluster },
    incidents: saved?.incidents ?? [],
    timeline: saved?.timeline ?? []
  };
}
