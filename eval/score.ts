import type { DiagnosisResult } from "../src/types";
import type { Scenario } from "./scenarios";

type Output = Omit<DiagnosisResult, "incidentId">;

// ---- cause matching ----

/** A hypothesis is correct when its title or reasoning contains an expected phrase. */
export function matchesCause(
  h: { title: string; why: string },
  causes: string[]
): boolean {
  const text = `${h.title} ${h.why}`.toLowerCase();
  return causes.some((c) => text.includes(c.toLowerCase()));
}

// ---- grounding ----

const WELL_KNOWN_NAMESPACES = new Set([
  "kube-system",
  "default",
  "kube-public",
  "kube-node-lease"
]);

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, "");

/**
 * Concrete cluster facts a hypothesis states that the input never contains:
 * namespaces, pod names, IPs, memory sizes, images, versions, exit codes and
 * restart counts. Placeholders like <ns> are not facts. This is a conservative
 * heuristic: it can miss a fabricated claim, and it can flag a harmless one.
 */
export function ungroundedFacts(text: string, input: string): string[] {
  const hay = squash(input);
  const has = (token: string) => hay.includes(squash(token));
  const standalone = (n: string) =>
    new RegExp(`(?<!\\d)${n}(?!\\d)`).test(input);
  const found = new Set<string>();
  const check = (token: string, grounded: boolean) => {
    if (!grounded) found.add(token);
  };

  for (const m of text.matchAll(
    /(?:-n|--namespace)[ =]([a-z0-9][a-z0-9-]*)/g
  )) {
    const ns = m[1] ?? "";
    check(`namespace ${ns}`, WELL_KNOWN_NAMESPACES.has(ns) || has(ns));
  }
  for (const m of text.matchAll(
    /\b[a-z0-9]+(?:-[a-z0-9]+)*-[a-f0-9]{8,10}-[a-z0-9]{5}\b/g
  )) {
    check(m[0], has(m[0]));
  }
  for (const m of text.matchAll(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g))
    check(m[0], has(m[0]));
  for (const m of text.matchAll(/\b\d+(?:\.\d+)?\s?(?:Ki|Mi|Gi|Ti)(?:B)?\b/g)) {
    check(m[0], has(m[0]));
  }
  for (const m of text.matchAll(
    /\b[a-z0-9.-]+\.[a-z]{2,}\/[\w./-]+(?::[\w.-]+)?/g
  )) {
    const image = m[0].replace(/[.,;:)]+$/, "");
    check(image, has(image));
  }
  for (const m of text.matchAll(/\bv\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?\b/g))
    check(m[0], has(m[0]));
  for (const m of text.matchAll(/exit code:? (\d+)/gi)) {
    check(`exit code ${m[1]}`, standalone(m[1] ?? ""));
  }
  for (const m of text.matchAll(/\b(\d+) restarts\b/gi)) {
    check(`${m[1]} restarts`, standalone(m[1] ?? ""));
  }
  return [...found];
}

// ---- scoring ----

export interface HypothesisResult {
  title: string;
  why: string;
  command: string;
  readOnly: boolean;
  ungrounded: string[];
}

export interface ScenarioResult {
  id: string;
  title: string;
  category: string | null;
  categoryOk: boolean;
  /** 1-based rank of the first correct hypothesis, or null. */
  rank: number | null;
  hypotheses: HypothesisResult[];
  error?: string;
}

export function scoreScenario(
  scenario: Scenario,
  output: Output
): ScenarioResult {
  const index = output.hypotheses.findIndex((h) =>
    matchesCause(h, scenario.expected.cause)
  );
  return {
    id: scenario.id,
    title: scenario.title,
    category: output.category,
    categoryOk: scenario.expected.category.includes(output.category),
    rank: index === -1 ? null : index + 1,
    hypotheses: output.hypotheses.map((h) => ({
      title: h.title,
      why: h.why,
      command: h.command,
      readOnly: h.readOnly,
      ungrounded: ungroundedFacts(
        `${h.title} ${h.why} ${h.command}`,
        scenario.input
      )
    }))
  };
}

export function failedScenario(
  scenario: Scenario,
  error: string
): ScenarioResult {
  return {
    id: scenario.id,
    title: scenario.title,
    category: null,
    categoryOk: false,
    rank: null,
    hypotheses: [],
    error
  };
}

export interface Summary {
  scenarios: number;
  errors: number;
  categoryCorrect: number;
  top1: number;
  top3: number;
  commands: number;
  readOnlyCommands: number;
  hypotheses: number;
  hypothesesWithUngrounded: number;
  scenariosWithUngrounded: number;
}

/** Scenarios that errored count as wrong everywhere, never as skipped. */
export function summarize(results: ScenarioResult[]): Summary {
  const hs = results.flatMap((r) => r.hypotheses);
  return {
    scenarios: results.length,
    errors: results.filter((r) => r.error).length,
    categoryCorrect: results.filter((r) => r.categoryOk).length,
    top1: results.filter((r) => r.rank === 1).length,
    top3: results.filter((r) => r.rank !== null && r.rank <= 3).length,
    commands: hs.length,
    readOnlyCommands: hs.filter((h) => h.readOnly).length,
    hypotheses: hs.length,
    hypothesesWithUngrounded: hs.filter((h) => h.ungrounded.length > 0).length,
    scenariosWithUngrounded: results.filter((r) =>
      r.hypotheses.some((h) => h.ungrounded.length > 0)
    ).length
  };
}

const pct = (n: number, d: number) =>
  d === 0 ? "n/a" : `${Math.round((100 * n) / d)}%`;

export function renderMarkdown(
  summary: Summary,
  results: ScenarioResult[],
  meta: { model: string; date: string }
): string {
  const s = summary;
  const rows = results.map((r) => {
    const top =
      r.hypotheses[0]?.title ??
      (r.error ? `error: ${r.error.slice(0, 60)}` : "none");
    const cat = r.categoryOk ? "✓" : `✗ ${r.category ?? "-"}`;
    const rank = r.rank === null ? "✗" : `#${r.rank}`;
    const grounded = r.hypotheses.every((h) => h.ungrounded.length === 0)
      ? "✓"
      : "✗";
    return `| ${r.id} | ${cat} | ${rank} | ${grounded} | ${top.replace(/\|/g, "/")} |`;
  });
  return [
    "# Evaluation results",
    "",
    `Model: \`${meta.model}\`. Run: ${meta.date}. ${s.scenarios} labelled scenarios, ${s.errors} errored.`,
    "",
    "| Metric | Result |",
    "| --- | --- |",
    `| Correct category | ${s.categoryCorrect}/${s.scenarios} (${pct(s.categoryCorrect, s.scenarios)}) |`,
    `| Correct cause is the top hypothesis | ${s.top1}/${s.scenarios} (${pct(s.top1, s.scenarios)}) |`,
    `| Correct cause is in the top 3 | ${s.top3}/${s.scenarios} (${pct(s.top3, s.scenarios)}) |`,
    `| Confirm commands that are read-only | ${s.readOnlyCommands}/${s.commands} (${pct(s.readOnlyCommands, s.commands)}) |`,
    `| Hypotheses stating a fact not in the input | ${s.hypothesesWithUngrounded}/${s.hypotheses} (${pct(s.hypothesesWithUngrounded, s.hypotheses)}) |`,
    `| Scenarios with at least one such hypothesis | ${s.scenariosWithUngrounded}/${s.scenarios} (${pct(s.scenariosWithUngrounded, s.scenarios)}) |`,
    "",
    "## Per scenario",
    "",
    "| Scenario | Category | Correct cause rank | Grounded | Top hypothesis |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    ""
  ].join("\n");
}
