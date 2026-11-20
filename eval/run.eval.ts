/**
 * Live evaluation: runs every labelled scenario through the same
 * `runDiagnosisSteps` pipeline the Workflow uses, against the real Workers AI
 * model (through your wrangler login), then writes eval/results.json and
 * eval/RESULTS.md.
 *
 *   npm run eval                  # all scenarios
 *   EVAL_LIMIT=3 npm run eval     # a quick smoke run (does not overwrite results)
 *
 * It differs from production in one way: steps run in-process with a simple
 * retry loop instead of as durable Workflow steps. The model, prompts, JSON
 * validation, ranking, placeholder filling and read-only check are identical.
 */
import { writeFileSync } from "node:fs";
import { getPlatformProxy } from "wrangler";
import { it } from "vitest";
import {
  runDiagnosisSteps,
  type DiagnosisDeps,
  type StepRunner
} from "../src/diagnosis-steps";
import { askModel } from "../src/llm";
import { MODEL } from "../src/model";
import { SCENARIOS } from "./scenarios";
import {
  failedScenario,
  renderMarkdown,
  scoreScenario,
  summarize,
  type ScenarioResult
} from "./score";

/** Same policy as the Workflow's LLM steps: 3 retries, exponential backoff from 2s. */
const retryingSteps = (): StepRunner => ({
  async run<T>(_name: string, retry: boolean, fn: () => Promise<T>) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (e) {
        if (!retry || attempt >= 3) throw e;
        await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
      }
    }
  }
});

it("evaluates the diagnosis pipeline on labelled scenarios", async () => {
  const limit = Number(process.env.EVAL_LIMIT ?? 0) || SCENARIOS.length;
  const concurrency = Number(process.env.EVAL_CONCURRENCY ?? 3);
  const scenarios = SCENARIOS.slice(0, limit);

  const proxy = await getPlatformProxy<{ AI: Ai }>({
    configPath: "wrangler.jsonc"
  });
  const deps: DiagnosisDeps = {
    ask: (system, prompt) => askModel(proxy.env.AI, system, prompt),
    similar: async () => [],
    approve: async () => false
  };

  const results: ScenarioResult[] = new Array(scenarios.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < scenarios.length; i = next++) {
      const scenario = scenarios[i]!;
      try {
        const output = await runDiagnosisSteps(
          { deps, steps: retryingSteps(), report: async () => {} },
          { input: scenario.input, clusterSummary: "" }
        );
        results[i] = scoreScenario(scenario, output);
      } catch (e) {
        results[i] = failedScenario(
          scenario,
          e instanceof Error ? e.message : String(e)
        );
      }
      const r = results[i]!;
      console.log(
        `[${i + 1}/${scenarios.length}] ${r.id}: category ${r.categoryOk ? "ok" : `WRONG (${r.category})`}, cause rank ${r.rank ?? "none"}${r.error ? `, ERROR ${r.error}` : ""}`
      );
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  await proxy.dispose();

  const summary = summarize(results);
  const meta = { model: MODEL, date: new Date().toISOString().slice(0, 10) };
  console.log(JSON.stringify(summary, null, 2));

  if (scenarios.length === SCENARIOS.length) {
    writeFileSync(
      "eval/results.json",
      JSON.stringify({ meta, summary, results }, null, 2) + "\n"
    );
    writeFileSync("eval/RESULTS.md", renderMarkdown(summary, results, meta));
  } else {
    console.log(
      "Partial run: eval/results.json and eval/RESULTS.md were not updated."
    );
  }
});
