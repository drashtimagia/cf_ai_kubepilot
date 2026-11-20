import { describe, expect, it, vi } from "vitest";
import { formatDiagnosis, run } from "../bin/kubepilot.mjs";
import { tokenFor } from "../scripts/token.mjs";
import { clusterToken } from "./alerts";
import type { Diagnosis } from "./types";

const done: Diagnosis = {
  id: "new",
  status: "complete",
  steps: [],
  error: null,
  result: {
    category: "CrashLoopBackOff",
    severity: "high",
    summary: "payments-api exits with code 1",
    signals: ["CrashLoopBackOff"],
    withheld: 1,
    incidentId: "inc-1",
    hypotheses: [
      {
        title: "Bad config",
        confidence: "high",
        why: "exit code 1",
        command: "kubectl logs p -n payments --previous",
        readOnly: true
      },
      {
        title: "Bad rollout",
        confidence: "low",
        why: "recent image",
        command: "kubectl rollout undo deployment/x",
        readOnly: false
      }
    ]
  }
};

const env = {
  KUBEPILOT_URL: "https://kp.example.com/",
  KUBEPILOT_CLUSTER: "prod-eu",
  KUBEPILOT_TOKEN: "tok"
};
const res = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status });

describe("formatDiagnosis", () => {
  it("flags cluster-changing commands and states nothing was run", () => {
    const text = formatDiagnosis(done);
    expect(text).toContain("CrashLoopBackOff (high)");
    expect(text).toContain("[read-only]");
    expect(text).toContain("[CHANGES THE CLUSTER]");
    expect(text).toContain("1 cluster-changing suggestion(s) withheld");
    expect(text).toContain("Nothing was run.");
  });
  it("reports failures", () => {
    expect(
      formatDiagnosis({
        ...done,
        status: "error",
        result: null,
        error: "model busy"
      })
    ).toBe("Diagnosis failed: model busy");
  });
});

describe("run", () => {
  const sleep = async () => {};

  it("posts the input with the bearer token, polls, and prints the diagnosis", async () => {
    const calls: Array<{ url: string; method: string; auth: string | null }> =
      [];
    const polls = [
      { diagnosis: { ...done, id: "old" } },
      { diagnosis: { ...done, id: "new", status: "running" } },
      { diagnosis: done }
    ];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({
        url,
        method,
        auth:
          ((init?.headers ?? {}) as Record<string, string>).authorization ??
          null
      });
      if (method === "POST") return res(202, { started: true });
      return res(200, polls.shift());
    });
    const lines: string[] = [];
    const code = await run({
      input: "kubectl output",
      env,
      fetchFn,
      log: (l) => lines.push(l),
      sleep
    });
    expect(code).toBe(0);
    expect(calls[1]).toMatchObject({
      url: "https://kp.example.com/api/clusters/prod-eu/diagnose",
      method: "POST",
      auth: "Bearer tok"
    });
    expect(lines.join("\n")).toContain("Ranked hypotheses");
  });

  it("does not print the previous run's result", async () => {
    const polls = [
      { diagnosis: { ...done, id: "old" } },
      { diagnosis: { ...done, id: "old" } },
      { diagnosis: { ...done, id: "new" } }
    ];
    const fetchFn = vi.fn(async (_u: string, init?: RequestInit) =>
      init?.method === "POST" ? res(202, {}) : res(200, polls.shift())
    );
    const lines: string[] = [];
    await run({ input: "x", env, fetchFn, log: (l) => lines.push(l), sleep });
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it("explains missing config, empty input and oversized input without calling the network", async () => {
    const fetchFn = vi.fn();
    const lines: string[] = [];
    const log = (l: string) => lines.push(l);
    expect(await run({ input: "x", env: {}, fetchFn, log, sleep })).toBe(2);
    expect(await run({ input: "  ", env, fetchFn, log, sleep })).toBe(2);
    expect(
      await run({ input: "x".repeat(200_001), env, fetchFn, log, sleep })
    ).toBe(2);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("reports an unauthorized token and a busy agent", async () => {
    const lines: string[] = [];
    const log = (l: string) => lines.push(l);
    const unauthorized = vi.fn(async (_u: string, init?: RequestInit) =>
      init?.method === "POST" ? res(401, {}) : res(200, { diagnosis: null })
    );
    expect(
      await run({ input: "x", env, fetchFn: unauthorized, log, sleep })
    ).toBe(1);
    const busy = vi.fn(async (_u: string, init?: RequestInit) =>
      init?.method === "POST"
        ? res(409, { error: "A diagnosis is already running." })
        : res(200, { diagnosis: null })
    );
    expect(await run({ input: "x", env, fetchFn: busy, log, sleep })).toBe(1);
    expect(lines.join("\n")).toContain("Unauthorized");
    expect(lines.join("\n")).toContain("already running");
  });
});

describe("token script", () => {
  it("matches the Worker's token derivation", async () => {
    expect(tokenFor("s3cret", "prod-eu")).toBe(
      await clusterToken("s3cret", "prod-eu")
    );
  });
});
