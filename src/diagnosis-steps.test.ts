import { describe, expect, it, vi } from "vitest";
import { isReadOnly } from "./diagnosis";
import {
  rankHypotheses,
  runDiagnosisSteps,
  timelineEntriesFor,
  type DiagnosisDeps,
  type StepRunner
} from "./diagnosis-steps";
import { fixture } from "./fixtures";
import type { DiagnosisProgress } from "./types";

const CLASSIFY = JSON.stringify({
  category: "CrashLoopBackOff",
  severity: "high",
  summary: "payments-api exits with code 1 on startup"
});
const HYPOTHESES = JSON.stringify({
  hypotheses: [
    {
      title: "Bad config",
      confidence: "medium",
      why: "exit code 1",
      command:
        "kubectl logs payments-api-7d9f8b6c5-x2k4p -n payments --previous"
    },
    {
      title: "DB down",
      confidence: "high",
      why: "needs DATABASE_URL",
      command: "kubectl get endpoints payments-db -n payments"
    },
    {
      title: "Bad rollout",
      confidence: "low",
      why: "recent image",
      command: "kubectl rollout undo deployment/payments-api -n payments"
    }
  ]
});

/** Mocked AI: answers classify first, hypotheses second. */
function fakeDeps(
  replies: string[]
): DiagnosisDeps & { ask: ReturnType<typeof vi.fn> } {
  const ask = vi.fn();
  replies.forEach((r) => ask.mockResolvedValueOnce(r));
  return { ask, similar: vi.fn().mockResolvedValue([]) };
}

/** Runs steps inline, retrying LLM steps like the workflow would. */
const steps = (retries = 0): StepRunner => ({
  async run<T>(_name: string, retry: boolean, fn: () => Promise<T>) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (e) {
        if (!retry || attempt >= retries) throw e;
      }
    }
  }
});

const params = {
  input: fixture("crashloop-describe"),
  clusterSummary: "prod-eu, Calico, bare metal"
};

describe("runDiagnosisSteps", () => {
  it("runs parse, classify, context, hypotheses in order and reports progress", async () => {
    const progress: DiagnosisProgress[] = [];
    const result = await runDiagnosisSteps(
      {
        deps: fakeDeps([CLASSIFY, HYPOTHESES]),
        steps: steps(),
        report: async (p) => void progress.push(p)
      },
      params
    );
    expect(
      progress.filter((p) => p.status === "running").map((p) => p.step)
    ).toEqual(["parse", "classify", "context", "hypotheses"]);
    expect(progress.at(-1)).toMatchObject({
      step: "hypotheses",
      status: "complete"
    });
    expect(result.category).toBe("CrashLoopBackOff");
    expect(result.signals[0]).toBe("CrashLoopBackOff");
  });

  it("ranks by confidence and decides read-only itself", async () => {
    const result = await runDiagnosisSteps(
      {
        deps: fakeDeps([CLASSIFY, HYPOTHESES]),
        steps: steps(),
        report: async () => {}
      },
      params
    );
    expect(result.hypotheses.map((h) => h.title)).toEqual([
      "DB down",
      "Bad config",
      "Bad rollout"
    ]);
    expect(result.hypotheses.map((h) => h.readOnly)).toEqual([
      true,
      true,
      false
    ]);
  });

  it("gives the model the runbook, cluster facts and similar past incidents", async () => {
    const deps = fakeDeps([CLASSIFY, HYPOTHESES]);
    deps.similar = vi.fn().mockResolvedValue([
      {
        id: "inc-old",
        title: "old crash",
        status: "resolved",
        resolution: "fixed secret"
      }
    ]);
    await runDiagnosisSteps(
      { deps, steps: steps(), report: async () => {} },
      params
    );
    const hypothesesCall = deps.ask.mock.calls[1] as [string, string];
    expect(hypothesesCall[1]).toContain("Known causes");
    expect(hypothesesCall[1]).toContain("Calico");
    expect(hypothesesCall[1]).toContain("inc-old");
    expect(hypothesesCall[1]).toContain("fixed secret");
  });

  it("retries an LLM step when the model returns invalid JSON", async () => {
    const deps = fakeDeps(["sorry, I cannot", CLASSIFY, HYPOTHESES]);
    const result = await runDiagnosisSteps(
      { deps, steps: steps(2), report: async () => {} },
      params
    );
    expect(deps.ask).toHaveBeenCalledTimes(3);
    expect(result.hypotheses).toHaveLength(3);
  });

  it("fails once retries are exhausted", async () => {
    const deps = fakeDeps(["nope", "nope"]);
    await expect(
      runDiagnosisSteps(
        { deps, steps: steps(1), report: async () => {} },
        params
      )
    ).rejects.toThrow();
  });

  it("maps an unknown category to Other and tolerates code fences", async () => {
    const fenced =
      "```json\n" + CLASSIFY.replace("CrashLoopBackOff", "Banana") + "\n```";
    const result = await runDiagnosisSteps(
      {
        deps: fakeDeps([fenced, HYPOTHESES]),
        steps: steps(),
        report: async () => {}
      },
      params
    );
    expect(result.category).toBe("Other");
  });
});

describe("isReadOnly", () => {
  it("accepts get, describe, logs, top", () => {
    for (const c of [
      "kubectl get pods -n x",
      "kubectl describe pod p",
      "kubectl logs p --previous",
      "kubectl top pod p"
    ]) {
      expect(isReadOnly(c), c).toBe(true);
    }
  });
  it("flags anything that changes the cluster, and non-kubectl commands", () => {
    for (const c of [
      "kubectl delete pod p",
      "kubectl rollout restart deploy/x",
      "kubectl drain n",
      "kubectl apply -f x.yaml",
      "kubectl exec p -- sh",
      "rm -rf /",
      "systemctl restart kubelet"
    ]) {
      expect(isReadOnly(c), c).toBe(false);
    }
  });
});

describe("timelineEntriesFor", () => {
  it("writes a note plus one hypothesis per ranked item, never evidence", () => {
    const entries = timelineEntriesFor({
      category: "OOMKilled",
      severity: "high",
      summary: "s",
      signals: [],
      hypotheses: rankHypotheses([
        {
          title: "t",
          confidence: "high",
          why: "w",
          command: "kubectl delete pod p"
        }
      ])
    });
    expect(entries.map((e) => e.kind)).toEqual(["note", "hypothesis"]);
    expect(entries[1]?.text).toContain("changes the cluster");
  });
});
