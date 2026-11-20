import { describe, expect, it } from "vitest";
import { fixture } from "./fixtures";
import { parseK8sOutput } from "./k8s-parse";
import { lookupRunbook, RUNBOOKS } from "./runbooks";

describe("runbooks", () => {
  it("covers about ten failure modes with unique ids", () => {
    expect(RUNBOOKS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(RUNBOOKS.map((r) => r.id)).size).toBe(RUNBOOKS.length);
  });

  it("every runbook has causes, checks and fixes, and checks are read-only", () => {
    for (const r of RUNBOOKS) {
      expect(r.causes.length, r.id).toBeGreaterThan(0);
      expect(r.checks.length, r.id).toBeGreaterThan(0);
      expect(r.fixes.length, r.id).toBeGreaterThan(0);
      expect(
        r.checks.every((c) => c.readOnly),
        r.id
      ).toBe(true);
      expect(
        r.fixes.every((c) => !c.readOnly),
        r.id
      ).toBe(true);
    }
  });

  it("finds a runbook for every signal the parser can emit", () => {
    for (const id of [
      "OOMKilled",
      "CrashLoopBackOff",
      "ImagePullBackOff",
      "FailedScheduling",
      "Evicted",
      "ConfigError",
      "ProbeFailed",
      "FailedMount",
      "NodeNotReady"
    ]) {
      expect(lookupRunbook(id)?.id, id).toBe(id);
    }
  });

  it("matches fixtures to the right runbook via the parser", () => {
    const top = (id: string) =>
      lookupRunbook(parseK8sOutput(fixture(id)).signals[0] ?? "")?.id;
    expect(top("crashloop-describe")).toBe("CrashLoopBackOff");
    expect(top("oomkilled-describe")).toBe("OOMKilled");
    expect(top("imagepull-describe")).toBe("ImagePullBackOff");
    expect(top("pending-describe")).toBe("FailedScheduling");
  });

  it("falls back to keywords and returns undefined for nonsense", () => {
    expect(lookupRunbook("pod is pending, insufficient memory")?.id).toBe(
      "FailedScheduling"
    );
    expect(lookupRunbook("zzzz qqqq")).toBeUndefined();
    expect(lookupRunbook("")).toBeUndefined();
  });
});
