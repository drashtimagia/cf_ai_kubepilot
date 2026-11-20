import { describe, expect, it } from "vitest";
import { parseK8sOutput } from "../src/k8s-parse";
import { SCENARIOS } from "./scenarios";
import {
  failedScenario,
  matchesCause,
  renderMarkdown,
  scoreScenario,
  summarize,
  ungroundedFacts
} from "./score";

describe("scenarios", () => {
  it("has 25 to 30 unique, labelled, context-sized scenarios", () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(25);
    expect(SCENARIOS.length).toBeLessThanOrEqual(30);
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
    for (const s of SCENARIOS) {
      expect(s.expected.cause.length, s.id).toBeGreaterThan(0);
      expect(s.expected.category.length, s.id).toBeGreaterThan(0);
      expect(s.input.length, s.id).toBeGreaterThan(80);
      expect(s.input.length, s.id).toBeLessThan(6000);
    }
  });

  it("covers every runbook category the classifier can choose", () => {
    const covered = new Set(SCENARIOS.flatMap((s) => s.expected.category));
    for (const c of [
      "CrashLoopBackOff",
      "OOMKilled",
      "ImagePullBackOff",
      "FailedScheduling",
      "Evicted",
      "ConfigError",
      "ProbeFailed",
      "FailedMount",
      "NodeNotReady",
      "ServiceNoEndpoints",
      "Other"
    ]) {
      expect(covered.has(c), c).toBe(true);
    }
  });

  it("the parser alone already finds the expected signal for the signal-bearing scenarios", () => {
    const detected = SCENARIOS.filter(
      (s) => parseK8sOutput(s.input).signals.length > 0
    );
    expect(detected.length).toBeGreaterThanOrEqual(20);
    for (const s of detected) {
      const top = parseK8sOutput(s.input).signals[0] ?? "";
      expect(
        s.expected.category.includes(top) ||
          s.expected.category.includes("Other") === false,
        s.id
      ).toBe(true);
    }
  });
});

describe("matchesCause", () => {
  it("matches phrases in title or reasoning, case-insensitively", () => {
    expect(
      matchesCause({ title: "Database unreachable", why: "x" }, ["database"])
    ).toBe(true);
    expect(
      matchesCause({ title: "t", why: "The JVM heap exceeds the limit" }, [
        "heap"
      ])
    ).toBe(true);
    expect(matchesCause({ title: "DNS", why: "x" }, ["database"])).toBe(false);
  });
});

describe("ungroundedFacts", () => {
  const input =
    "Name: payments-api-7d9f8b6c5-x2k4p\nNamespace: payments\nmemory: 256Mi\nExit Code: 137\nRestart Count: 7\nImage: registry.example.com/payments-api:2.14.0";

  it("accepts facts that are in the input", () => {
    const text =
      "Pod payments-api-7d9f8b6c5-x2k4p hit exit code 137 after 7 restarts, limit 256 Mi, image registry.example.com/payments-api:2.14.0. kubectl logs -n payments x";
    expect(ungroundedFacts(text, input)).toEqual([]);
  });

  it("flags invented namespaces, sizes, pods, IPs, versions and counts", () => {
    const out = ungroundedFacts(
      "limit is 512Mi on pod billing-5b9c7d6f4-q8w2n at 10.1.2.3 running v9.9.9, exit code 1 after 42 restarts, kubectl get pods -n billing",
      input
    );
    expect(out).toEqual(
      expect.arrayContaining([
        "512Mi",
        "billing-5b9c7d6f4-q8w2n",
        "10.1.2.3",
        "v9.9.9",
        "exit code 1",
        "42 restarts",
        "namespace billing"
      ])
    );
  });

  it("does not treat placeholders or well-known namespaces as facts", () => {
    expect(
      ungroundedFacts(
        "kubectl get pods -n <ns>; kubectl get pods -n kube-system",
        input
      )
    ).toEqual([]);
  });
});

describe("scoring and summary", () => {
  const scenario = SCENARIOS[0]!;
  const hyp = (
    title: string,
    why = "x",
    command = "kubectl get pods",
    readOnly = true
  ) => ({ title, why, command, readOnly, confidence: "high" as const });
  const out = (
    hypotheses: ReturnType<typeof hyp>[],
    category = scenario.expected.category[0]!
  ) => ({
    category,
    severity: "high" as const,
    summary: "s",
    signals: [],
    withheld: 0,
    hypotheses
  });

  it("ranks the first correct hypothesis", () => {
    const r = scoreScenario(
      scenario,
      out([hyp("Unrelated"), hyp("The database refused the connection")])
    );
    expect(r.rank).toBe(2);
    expect(r.categoryOk).toBe(true);
  });

  it("reports no rank when nothing matches, and flags the wrong category", () => {
    const r = scoreScenario(scenario, out([hyp("Nope")], "OOMKilled"));
    expect(r.rank).toBeNull();
    expect(r.categoryOk).toBe(false);
  });

  it("summarizes top-1, top-3, read-only rate and grounding, counting errors as wrong", () => {
    const results = [
      scoreScenario(scenario, out([hyp("database down")])),
      scoreScenario(
        scenario,
        out([
          hyp("a"),
          hyp("b"),
          hyp("database down", "x", "kubectl delete pod p", false)
        ])
      ),
      scoreScenario(
        scenario,
        out([hyp("a"), hyp("b"), hyp("c"), hyp("database down")])
      ),
      scoreScenario(scenario, out([hyp("fabricated", "limit is 999Mi")])),
      failedScenario(scenario, "model busy")
    ];
    const s = summarize(results);
    expect(s).toMatchObject({
      scenarios: 5,
      errors: 1,
      top1: 1,
      top3: 2,
      commands: 9,
      readOnlyCommands: 8,
      hypothesesWithUngrounded: 1
    });
    expect(s.scenariosWithUngrounded).toBe(1);
  });

  it("renders a markdown table with the headline metrics", () => {
    const results = [scoreScenario(scenario, out([hyp("database down")]))];
    const md = renderMarkdown(summarize(results), results, {
      model: "m",
      date: "2026-11-19"
    });
    expect(md).toContain("Correct cause is in the top 3");
    expect(md).toContain("| crash-db-refused |");
  });
});
