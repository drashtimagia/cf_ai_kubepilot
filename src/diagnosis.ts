import { z } from "zod";
import { RUNBOOKS } from "./runbooks";
import { SEVERITIES } from "./types";

/** Commands that change or remove things. We only ever suggest, never run. */
const DESTRUCTIVE =
  /\b(delete|drain|cordon|uncordon|taint|replace|patch|scale|rollout\s+(restart|undo)|apply|edit|create|set\s+(image|resources)|annotate|label|exec|rm|kill|reboot|restart)\b|--force|--grace-period=0/i;

/**
 * True only for kubectl commands that look read-only. Anything else, or
 * anything we cannot classify, is treated as changing the cluster.
 */
export function isReadOnly(command: string): boolean {
  const c = command.trim();
  return /^kubectl\s/.test(c) && !DESTRUCTIVE.test(c);
}

const CATEGORIES = new Set(RUNBOOKS.map((r) => r.id));

export const classificationSchema = z.object({
  category: z.string().transform((c) => (CATEGORIES.has(c) ? c : "Other")),
  severity: z.enum(SEVERITIES),
  summary: z.string().min(1).max(300)
});
export type Classification = z.infer<typeof classificationSchema>;

export const hypothesesSchema = z.object({
  hypotheses: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        confidence: z.enum(["low", "medium", "high"]),
        why: z.string().min(1).max(400),
        command: z.string().min(1).max(300)
      })
    )
    .min(1)
    .max(5)
});

/** Pulls the first JSON object out of model text (handles ```json fences and chatter). */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start)
    throw new Error("No JSON object in model output");
  return JSON.parse(text.slice(start, end + 1));
}

/** Parses model output against a schema; throws so workflow retries kick in. */
export function parseModelJson<T>(text: string, schema: z.ZodType<T>): T {
  return schema.parse(extractJson(text));
}
