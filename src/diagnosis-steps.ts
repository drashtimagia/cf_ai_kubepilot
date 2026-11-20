import {
  classificationSchema,
  hypothesesSchema,
  isReadOnly,
  parseModelJson,
  type Classification
} from "./diagnosis";
import { parseK8sOutput, type K8sFacts } from "./k8s-parse";
import { fillPlaceholders } from "./placeholders";
import { lookupRunbook, RUNBOOKS, type Runbook } from "./runbooks";
import type {
  DiagnosisProgress,
  DiagnosisResult,
  Hypothesis,
  TimelineKind
} from "./types";

/**
 * The diagnosis pipeline as plain functions. The Workflow wires real
 * dependencies in; tests wire fakes. Nothing here touches Workers AI.
 */

export interface DiagnosisParams {
  /** Pasted kubectl output, logs or alert text (already length-limited). */
  input: string;
  /** Cluster facts the user stated, as one line. */
  clusterSummary: string;
  /** Namespace the user told us about, used to fill command placeholders. */
  namespace?: string;
  /** Pause before keeping cluster-changing suggestions until a human approves. */
  requireApproval?: boolean;
}

export interface PastIncident {
  id: string;
  title: string;
  status: string;
  resolution: string | null;
}

export interface DiagnosisDeps {
  /** One LLM call. Returns raw text. */
  ask(system: string, prompt: string): Promise<string>;
  /** Past incidents sharing any of these signals. */
  similar(signals: string[]): Promise<PastIncident[]>;
  /** Resolves true only when a human approved. Rejection or timeout is false. */
  approve(): Promise<boolean>;
}

export interface StepRunner {
  /** Durable step. `retry` marks LLM steps that should back off and retry. */
  run<T>(name: string, retry: boolean, fn: () => Promise<T>): Promise<T>;
}

export interface StepContext {
  runbook: Runbook | null;
  similar: PastIncident[];
  clusterSummary: string;
}

const CONFIDENCE_RANK = { high: 0, medium: 1, low: 2 } as const;

export function gatherContext(
  classification: Classification,
  clusterSummary: string,
  similar: PastIncident[]
): StepContext {
  return {
    runbook: lookupRunbook(classification.category) ?? null,
    similar,
    clusterSummary
  };
}

export function classifyPrompt(
  facts: K8sFacts,
  input: string,
  clusterSummary: string
) {
  return {
    system: `You are a Kubernetes SRE classifying an incident from evidence.
Reply with a JSON object: {"category": string, "severity": "low"|"medium"|"high"|"critical", "summary": string}.
"category" is one of: ${[...RUNBOOKS.map((r) => r.id), "Other"].join(", ")}. "summary" is one sentence naming only what the evidence shows.`,
    prompt: `Cluster facts from the user: ${clusterSummary || "none stated"}
Detected signals: ${facts.signals.join(", ") || "none"}
Parsed facts: ${JSON.stringify({ kind: facts.kind, pods: facts.pods, events: facts.events.slice(0, 6), logErrors: facts.logErrors })}

Evidence:
${input}`
  };
}

export function hypothesesPrompt(
  classification: Classification,
  ctx: StepContext
) {
  const runbook = ctx.runbook
    ? `Known causes: ${ctx.runbook.causes.join("; ")}\nKnown read-only checks: ${ctx.runbook.checks.map((c) => c.command).join("; ")}`
    : "No runbook for this category.";
  const past = ctx.similar.length
    ? ctx.similar
        .map(
          (i) =>
            `${i.id} ${i.title} (${i.status})${i.resolution ? ` fixed by: ${i.resolution}` : ""}`
        )
        .join("\n")
    : "none";
  return {
    system: `You are a Kubernetes SRE. List up to 4 hypotheses for the root cause, most likely first.
Reply with a JSON object: {"hypotheses": [{"title": string, "confidence": "low"|"medium"|"high", "why": string, "command": string}]}.
Each "command" is ONE kubectl command that would confirm or rule out that hypothesis. Prefer read-only commands. Use placeholders like <pod> when a name is unknown. Rank the causes the evidence directly supports first, and leave out a known cause that the evidence contradicts or does not support. These are hypotheses, not facts: do not state cluster details that are not in the input.`,
    prompt: `Category: ${classification.category}
Summary: ${classification.summary}
Cluster facts from the user: ${ctx.clusterSummary || "none stated"}
${runbook}
Similar past incidents:
${past}`
  };
}

/** Most confident first; read-only is decided by us, never by the model. */
export function rankHypotheses(
  raw: Array<Omit<Hypothesis, "readOnly">>
): Hypothesis[] {
  return raw
    .map((h, i) => ({ h, i }))
    .sort(
      (a, b) =>
        CONFIDENCE_RANK[a.h.confidence] - CONFIDENCE_RANK[b.h.confidence] ||
        a.i - b.i
    )
    .map(({ h }) => ({ ...h, readOnly: isReadOnly(h.command) }));
}

/** True when any suggestion would change the cluster. */
export const needsReview = (hypotheses: Hypothesis[]): boolean =>
  hypotheses.some((h) => !h.readOnly);

/** Without approval, only read-only suggestions are kept. */
export const applyReview = (
  hypotheses: Hypothesis[],
  approved: boolean
): Hypothesis[] =>
  approved ? hypotheses : hypotheses.filter((h) => h.readOnly);

export interface DiagnosisRun {
  deps: DiagnosisDeps;
  steps: StepRunner;
  report(progress: DiagnosisProgress): Promise<void>;
}

export async function runDiagnosisSteps(
  { deps, steps, report }: DiagnosisRun,
  { input, clusterSummary, namespace, requireApproval }: DiagnosisParams
): Promise<Omit<DiagnosisResult, "incidentId">> {
  await report({ step: "parse", status: "running" });
  const facts = await steps.run("parse", false, async () =>
    parseK8sOutput(input)
  );
  await report({
    step: "parse",
    status: "complete",
    message: facts.signals.length
      ? facts.signals.join(", ")
      : "No known signals"
  });

  await report({ step: "classify", status: "running" });
  const classification = await steps.run("classify", true, async () => {
    const { system, prompt } = classifyPrompt(facts, input, clusterSummary);
    return parseModelJson(await deps.ask(system, prompt), classificationSchema);
  });
  await report({
    step: "classify",
    status: "complete",
    message: `${classification.category}, ${classification.severity}`
  });

  await report({ step: "context", status: "running" });
  const ctx = await steps.run("context", false, async () =>
    gatherContext(
      classification,
      clusterSummary,
      await deps.similar(facts.signals)
    )
  );
  await report({
    step: "context",
    status: "complete",
    message: `${ctx.runbook ? "runbook found" : "no runbook"}, ${ctx.similar.length} similar past`
  });

  await report({ step: "hypotheses", status: "running" });
  const hypotheses = await steps.run("hypotheses", true, async () => {
    const { system, prompt } = hypothesesPrompt(classification, ctx);
    const { hypotheses } = parseModelJson(
      await deps.ask(system, prompt),
      hypothesesSchema
    );
    // Fill <ns>, <pod> and friends from the evidence, then classify read-only.
    return rankHypotheses(
      hypotheses.map((h) => ({
        ...h,
        command: fillPlaceholders(h.command, facts, namespace)
      }))
    );
  });
  await report({
    step: "hypotheses",
    status: "complete",
    message: `${hypotheses.length} ranked`
  });

  let kept = hypotheses;
  if (requireApproval && needsReview(hypotheses)) {
    const risky = hypotheses.filter((h) => !h.readOnly).length;
    await report({
      step: "review",
      status: "waiting",
      message: `${risky} cluster-changing suggestion${risky === 1 ? "" : "s"} need your approval`
    });
    const approved = await deps.approve();
    kept = applyReview(hypotheses, approved);
    await report({
      step: "review",
      status: "complete",
      message: approved ? "approved" : `not approved, ${risky} withheld`
    });
  } else {
    await report({
      step: "review",
      status: "complete",
      message: requireApproval ? "nothing to review" : "approval not required"
    });
  }

  return {
    category: classification.category,
    severity: classification.severity,
    summary: classification.summary,
    signals: facts.signals,
    hypotheses: kept,
    withheld: hypotheses.length - kept.length
  };
}

/** Timeline rows to write for a finished diagnosis. All of it is LLM output. */
export function timelineEntriesFor(
  result: Omit<DiagnosisResult, "incidentId">
): Array<{ kind: TimelineKind; text: string }> {
  return [
    {
      kind: "note",
      text: `Diagnosis run: ${result.category} (${result.severity}). ${result.summary}`
    },
    ...result.hypotheses.map((h) => ({
      kind: "hypothesis" as const,
      text: `${h.title} [${h.confidence}]. Confirm with: ${h.command}${h.readOnly ? "" : " (changes the cluster)"}`
    }))
  ];
}
