import { describe, expect, it, vi } from "vitest";
import { isReadOnly } from "./diagnosis";
import {
  applyReview,
  needsReview,
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
function fakeDeps(replies: string[]): DiagnosisDeps & {
  ask: ReturnType<typeof vi.fn>;
  approve: ReturnType<typeof vi.fn>;
} {
  const ask = vi.fn();
  replies.forEach((r) => ask.mockResolvedValueOnce(r));
  return {
    ask,
    similar: vi.fn().mockResolvedValue([]),
    approve: vi.fn().mockResolvedValue(false)
  };
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
      step: "review",
      status: "complete",
      message: "approval not required"
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

describe("approval step", () => {
  const run = (deps: ReturnType<typeof fakeDeps>, requireApproval: boolean) => {
    const progress: DiagnosisProgress[] = [];
    return runDiagnosisSteps(
      { deps, steps: steps(), report: async (p) => void progress.push(p) },
      { ...params, requireApproval }
    ).then((result) => ({ result, progress }));
  };

  it("does not pause when approval is not required", async () => {
    const deps = fakeDeps([CLASSIFY, HYPOTHESES]);
    const { result, progress } = await run(deps, false);
    expect(deps.approve).not.toHaveBeenCalled();
    expect(result.hypotheses).toHaveLength(3);
    expect(result.withheld).toBe(0);
    expect(progress.some((p) => p.status === "waiting")).toBe(false);
  });

  it("waits, and keeps cluster-changing suggestions only when approved", async () => {
    const deps = fakeDeps([CLASSIFY, HYPOTHESES]);
    deps.approve.mockResolvedValue(true);
    const { result, progress } = await run(deps, true);
    expect(progress.find((p) => p.status === "waiting")).toMatchObject({
      step: "review"
    });
    expect(result.hypotheses).toHaveLength(3);
    expect(result.withheld).toBe(0);
  });

  it("withholds cluster-changing suggestions when rejected or timed out", async () => {
    const deps = fakeDeps([CLASSIFY, HYPOTHESES]);
    deps.approve.mockResolvedValue(false);
    const { result } = await run(deps, true);
    expect(result.hypotheses.every((h) => h.readOnly)).toBe(true);
    expect(result.hypotheses).toHaveLength(2);
    expect(result.withheld).toBe(1);
  });

  it("skips the pause when every suggestion is read-only", async () => {
    const readOnly = JSON.stringify({
      hypotheses: [
        {
          title: "t",
          confidence: "high",
          why: "w",
          command: "kubectl get pods -n payments"
        }
      ]
    });
    const deps = fakeDeps([CLASSIFY, readOnly]);
    await run(deps, true);
    expect(deps.approve).not.toHaveBeenCalled();
  });

  it("needsReview and applyReview are pure", () => {
    const hs = rankHypotheses([
      { title: "a", confidence: "high", why: "w", command: "kubectl get pods" },
      {
        title: "b",
        confidence: "low",
        why: "w",
        command: "kubectl delete pod x"
      }
    ]);
    expect(needsReview(hs)).toBe(true);
    expect(applyReview(hs, false).map((h) => h.title)).toEqual(["a"]);
    expect(applyReview(hs, true)).toHaveLength(2);
  });
});

describe("placeholders in hypotheses", () => {
  it("fills <ns> and <pod> from the evidence before classifying", async () => {
    const reply = JSON.stringify({
      hypotheses: [
        {
          title: "t",
          confidence: "high",
          why: "w",
          command: "kubectl logs <pod> -n <ns> --previous"
        }
      ]
    });
    const result = await runDiagnosisSteps(
      {
        deps: fakeDeps([CLASSIFY, reply]),
        steps: steps(),
        report: async () => {}
      },
      params
    );
    expect(result.hypotheses[0]?.command).toBe(
      "kubectl logs payments-api-7d9f8b6c5-x2k4p -n payments --previous"
    );
  });
});

describe("timelineEntriesFor", () => {
  it("writes a note plus one hypothesis per ranked item, never evidence", () => {
    const entries = timelineEntriesFor({
      category: "OOMKilled",
      severity: "high",
      summary: "s",
      withheld: 0,
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
