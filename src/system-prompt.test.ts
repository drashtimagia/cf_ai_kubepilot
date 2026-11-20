import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./system-prompt";
import { INITIAL_STATE, type Incident } from "./types";

describe("buildSystemPrompt", () => {
  const incident = (over: Partial<Incident>): Incident => ({
    id: "inc-1",
    title: "payments OOMKilled",
    severity: "high",
    status: "open",
    summary: "",
    signals: [],
    resolution: null,
    createdAt: "2026-11-19T00:00:00Z",
    updatedAt: "2026-11-19T00:00:00Z",
    ...over
  });

  it("says so when there is no memory", () => {
    expect(buildSystemPrompt(INITIAL_STATE)).toContain(
      "No cluster context saved yet."
    );
  });

  it("includes cluster context and unresolved incidents only", () => {
    const prompt = buildSystemPrompt({
      cluster: {
        name: "prod-eu",
        namespace: "payments",
        version: "",
        cni: "",
        platform: "",
        notes: ["EKS 1.31"]
      },
      incidents: [
        incident({ id: "inc-open" }),
        incident({ id: "inc-done", status: "resolved" })
      ],
      activeIncidentId: null,
      timeline: [],
      diagnosis: null
    });
    expect(prompt).toContain("Cluster: prod-eu");
    expect(prompt).toContain("- EKS 1.31");
    expect(prompt).toContain("inc-open");
    expect(prompt).not.toContain("inc-done");
  });

  it("tells the model never to invent facts and how to label commands", () => {
    const prompt = buildSystemPrompt(INITIAL_STATE);
    expect(prompt).toContain("Never make up facts");
    expect(prompt).toContain("read-only");
    expect(prompt).toContain("changes the cluster");
    expect(prompt).toContain("characters truncated");
  });
});
