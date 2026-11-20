import { describe, expect, it } from "vitest";
import { fixture, FIXTURES } from "./fixtures";
import { parseK8sOutput } from "./k8s-parse";

describe("parseK8sOutput", () => {
  it("extracts a CrashLoopBackOff pod from describe", () => {
    const f = parseK8sOutput(fixture("crashloop-describe"));
    expect(f.kind).toBe("describe");
    const pod = f.pods[0]!;
    expect(pod).toMatchObject({
      name: "payments-api-7d9f8b6c5-x2k4p",
      namespace: "payments",
      node: "ip-10-0-3-41.eu-west-1.compute.internal",
      status: "Running",
      restarts: 7
    });
    expect(pod.containers[0]).toMatchObject({
      name: "api",
      state: "Waiting",
      reason: "CrashLoopBackOff",
      lastReason: "Error",
      exitCode: 1,
      restarts: 7,
      memoryLimit: "512Mi"
    });
    expect(f.signals[0]).toBe("CrashLoopBackOff");
    expect(f.exitCodes).toEqual([1]);
  });

  it("parses events with repeat counts", () => {
    const { events } = parseK8sOutput(fixture("crashloop-describe"));
    expect(events).toHaveLength(3);
    expect(events[2]).toMatchObject({
      type: "Warning",
      reason: "BackOff",
      age: "4m (x38 over 14m)"
    });
    expect(events[2]!.message).toContain(
      "Back-off restarting failed container"
    );
  });

  it("detects OOMKilled with exit 137 and the memory limit", () => {
    const f = parseK8sOutput(fixture("oomkilled-describe"));
    expect(f.signals[0]).toBe("OOMKilled");
    expect(f.exitCodes).toEqual([137]);
    expect(f.pods[0]!.containers[0]).toMatchObject({
      state: "Running",
      lastReason: "OOMKilled",
      exitCode: 137,
      memoryLimit: "256Mi"
    });
  });

  it("detects ImagePullBackOff and the image", () => {
    const f = parseK8sOutput(fixture("imagepull-describe"));
    expect(f.signals).toContain("ImagePullBackOff");
    expect(f.signals).not.toContain("CrashLoopBackOff");
    expect(f.pods[0]!.containers[0]).toMatchObject({
      reason: "ImagePullBackOff",
      image: "registry.example.com/reports:v3.0.0-rc1"
    });
    expect(f.pods[0]!.status).toBe("Pending");
  });

  it("detects a pod that never got scheduled", () => {
    const f = parseK8sOutput(fixture("pending-describe"));
    expect(f.signals).toContain("FailedScheduling");
    expect(f.pods[0]!.node).toBeUndefined();
    expect(f.events[0]).toMatchObject({
      type: "Warning",
      reason: "FailedScheduling"
    });
    expect(f.events[0]!.message).toContain("Insufficient cpu");
  });

  it("parses kubectl get pods -A rows", () => {
    const f = parseK8sOutput(fixture("get-pods"));
    expect(f.kind).toBe("get-pods");
    expect(f.pods).toHaveLength(5);
    expect(f.pods[0]).toMatchObject({
      namespace: "payments",
      name: "payments-api-7d9f8b6c5-x2k4p",
      ready: "0/1",
      status: "CrashLoopBackOff",
      restarts: 7
    });
    expect(f.pods[4]).toMatchObject({ namespace: "kube-system", restarts: 0 });
  });

  it("pulls error lines out of logs", () => {
    const f = parseK8sOutput(fixture("crash-logs"));
    expect(f.kind).toBe("logs");
    expect(f.logErrors.some((l) => l.includes("connection refused"))).toBe(
      true
    );
    expect(
      f.logErrors.some((l) => l.includes("panic: database unavailable"))
    ).toBe(true);
  });

  it("returns an empty unknown result for unrelated text", () => {
    const f = parseK8sOutput("hello, my pod is sad");
    expect(f).toMatchObject({
      kind: "unknown",
      pods: [],
      events: [],
      signals: []
    });
  });

  it("parses every fixture without throwing", () => {
    for (const { text } of FIXTURES)
      expect(() => parseK8sOutput(text)).not.toThrow();
  });
});
