import { describe, expect, it } from "vitest";
import {
  alertKey,
  alertSeverity,
  alertTitle,
  alertToEvidence,
  alertmanagerSchema,
  bearerToken,
  clusterToken,
  parseApiPath,
  verifyToken,
  type Alert
} from "./alerts";
import { parseK8sOutput } from "./k8s-parse";

const alert = (over: Partial<Alert> = {}): Alert => ({
  status: "firing",
  labels: {
    alertname: "KubePodCrashLooping",
    namespace: "payments",
    pod: "payments-api-7d9f8b6c5-x2k4p",
    severity: "critical"
  },
  annotations: {
    summary: "Pod is crash looping",
    description: "restarted 7 times in 10m"
  },
  fingerprint: "abc123",
  ...over
});

describe("alertmanager payload", () => {
  it("accepts a real-shaped payload and ignores extra fields", () => {
    const parsed = alertmanagerSchema.parse({
      version: "4",
      receiver: "kubepilot",
      status: "firing",
      alerts: [alert()]
    });
    expect(parsed.alerts).toHaveLength(1);
  });
  it("rejects bad shapes and floods", () => {
    expect(() =>
      alertmanagerSchema.parse({ alerts: [{ status: "weird", labels: {} }] })
    ).toThrow();
    expect(() =>
      alertmanagerSchema.parse({
        alerts: Array.from({ length: 21 }, () => alert())
      })
    ).toThrow();
    expect(() => alertmanagerSchema.parse({})).toThrow();
  });
});

describe("alert mapping", () => {
  it("builds a title, severity and plain-text evidence", () => {
    expect(alertTitle(alert())).toBe(
      "KubePodCrashLooping: payments/payments-api-7d9f8b6c5-x2k4p"
    );
    expect(alertSeverity(alert())).toBe("critical");
    expect(alertSeverity(alert({ labels: { severity: "warning" } }))).toBe(
      "medium"
    );
    const text = alertToEvidence(alert());
    expect(text).toContain("alertname=KubePodCrashLooping");
    expect(text).toContain("summary: Pod is crash looping");
  });
  it("maps well-known alert names to failure signals the diagnosis understands", () => {
    expect(parseK8sOutput(alertToEvidence(alert())).signals).toContain(
      "CrashLoopBackOff"
    );
    const node = alert({
      labels: { alertname: "KubeNodeNotReady", node: "worker-2" }
    });
    expect(parseK8sOutput(alertToEvidence(node)).signals).toContain(
      "NodeNotReady"
    );
  });
  it("dedupes on fingerprint, else on sorted labels", () => {
    expect(alertKey(alert())).toBe("abc123");
    const a = alertKey(
      alert({ fingerprint: undefined, labels: { b: "2", a: "1" } })
    );
    const b = alertKey(
      alert({ fingerprint: undefined, labels: { a: "1", b: "2" } })
    );
    expect(a).toBe(b);
  });
});

describe("cluster tokens", () => {
  it("are stable, distinct per cluster, and verified", async () => {
    const t = await clusterToken("s3cret", "prod-eu");
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(await clusterToken("s3cret", "prod-eu")).toBe(t);
    expect(await clusterToken("s3cret", "prod-us")).not.toBe(t);
    expect(await verifyToken("s3cret", "prod-eu", t)).toBe(true);
  });
  it("reject wrong, missing, other-cluster and other-secret tokens", async () => {
    const t = await clusterToken("s3cret", "prod-eu");
    expect(await verifyToken("s3cret", "prod-eu", null)).toBe(false);
    expect(await verifyToken("s3cret", "prod-eu", "nope")).toBe(false);
    expect(await verifyToken("s3cret", "prod-us", t)).toBe(false);
    expect(await verifyToken("other", "prod-eu", t)).toBe(false);
  });
  it("parses bearer headers", () => {
    expect(bearerToken("Bearer abc")).toBe("abc");
    expect(bearerToken("bearer abc")).toBe("abc");
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });
});

describe("parseApiPath", () => {
  it("matches the three routes with valid cluster ids", () => {
    expect(parseApiPath("/api/clusters/prod-eu/alerts")).toEqual({
      clusterId: "prod-eu",
      action: "alerts"
    });
    expect(parseApiPath("/api/clusters/prod-eu/diagnose")?.action).toBe(
      "diagnose"
    );
    expect(parseApiPath("/api/clusters/prod-eu/diagnosis/")?.action).toBe(
      "diagnosis"
    );
  });
  it("rejects bad ids, unknown actions and traversal", () => {
    for (const p of [
      "/api/clusters/A/alerts",
      "/api/clusters/ab/alerts",
      "/api/clusters/Prod_EU/alerts",
      "/api/clusters/prod-eu/delete",
      "/api/clusters/../alerts",
      "/api/clusters/prod-eu/alerts/x"
    ]) {
      expect(parseApiPath(p), p).toBeUndefined();
    }
  });
});
