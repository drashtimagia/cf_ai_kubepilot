import { describe, expect, it } from "vitest";
import { formatTimeline, normalizeState, resolveKind } from "./memory";
import { buildSystemPrompt } from "./system-prompt";
import { INITIAL_STATE, type Incident, type TimelineEntry } from "./types";

const entry = (
  id: number,
  kind: TimelineEntry["kind"],
  text: string
): TimelineEntry => ({
  id,
  incidentId: "inc-1",
  kind,
  text,
  source: "agent",
  createdAt: "2026-11-19T00:00:00Z"
});

describe("resolveKind", () => {
  const user = ["Exit Code:    137\n  Reason: OOMKilled"];
  it("keeps evidence the user actually said, ignoring whitespace and case", () => {
    expect(resolveKind("evidence", "exit code: 137", user)).toBe("evidence");
  });
  it("downgrades invented evidence to a hypothesis", () => {
    expect(
      resolveKind("evidence", "memory leak in the cache layer", user)
    ).toBe("hypothesis");
  });
  it("passes other kinds through", () => {
    expect(resolveKind("action", "anything", user)).toBe("action");
  });
});

describe("formatTimeline", () => {
  it("labels hypotheses as unconfirmed", () => {
    expect(
      formatTimeline([entry(1, "hypothesis", "limit too low")])[0]
    ).toContain("unconfirmed");
  });
  it("keeps the newest entries within the size limit, in order", () => {
    const entries = Array.from({ length: 50 }, (_, i) =>
      entry(i, "note", `note ${i} ${"x".repeat(100)}`)
    );
    const lines = formatTimeline(entries, 500);
    expect(lines.join("").length).toBeLessThanOrEqual(500);
    expect(lines.at(-1)).toContain("note 49");
    expect(lines[0]).not.toContain("note 0 ");
  });
});

describe("prompt memory", () => {
  const incident: Incident = {
    id: "inc-1",
    title: "payments OOMKilled",
    severity: "high",
    status: "open",
    summary: "",
    signals: [],
    resolution: null,
    createdAt: "",
    updatedAt: ""
  };
  it("remembers Calico on bare metal without being told again", () => {
    const p = buildSystemPrompt({
      ...INITIAL_STATE,
      cluster: {
        ...INITIAL_STATE.cluster,
        cni: "Calico",
        platform: "bare metal"
      }
    });
    expect(p).toContain("CNI: Calico");
    expect(p).toContain("Platform: bare metal");
  });
  it("includes the active incident and its recent timeline", () => {
    const p = buildSystemPrompt({
      ...INITIAL_STATE,
      incidents: [incident],
      activeIncidentId: "inc-1",
      timeline: [entry(1, "evidence", "Exit Code: 137")]
    });
    expect(p).toContain("Active incident: inc-1");
    expect(p).toContain("[evidence] Exit Code: 137");
  });
});

describe("normalizeState", () => {
  it("upgrades state saved by an older version without losing data", () => {
    const old = {
      cluster: { name: "prod-eu", namespace: "payments", notes: ["EKS 1.31"] },
      incidents: []
    } as unknown as Parameters<typeof normalizeState>[0];
    const s = normalizeState(old);
    expect(s.cluster).toMatchObject({
      name: "prod-eu",
      notes: ["EKS 1.31"],
      cni: "",
      platform: ""
    });
    expect(s.timeline).toEqual([]);
    expect(s.activeIncidentId).toBeNull();
    expect(s.diagnosis).toBeNull();
  });
  it("handles missing state", () => {
    expect(normalizeState(undefined)).toEqual(INITIAL_STATE);
  });
});
