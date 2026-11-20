import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { IncidentStore, type Sql } from "./incident-store";

/** Runs the store's real SQL against Node's built-in SQLite. */
function makeStore(): IncidentStore {
  const db = new DatabaseSync(":memory:");
  const sql = ((strings: TemplateStringsArray, ...values: SQLInputValue[]) =>
    db.prepare(strings.join("?")).all(...values)) as Sql;
  const store = new IncidentStore(sql);
  store.init();
  return store;
}

describe("IncidentStore", () => {
  let store: IncidentStore;
  beforeEach(() => {
    store = makeStore();
  });

  const input = {
    title: "payments pod OOMKilled",
    severity: "high" as const,
    summary: "exit code 137 after deploy",
    signals: ["OOMKilled", "CrashLoopBackOff"]
  };

  it("creates and reads back an incident", () => {
    const incident = store.create(input);
    expect(incident.id).toMatch(/^inc-/);
    expect(incident.status).toBe("open");
    expect(incident.signals).toEqual(["OOMKilled", "CrashLoopBackOff"]);
    expect(store.get(incident.id)?.title).toBe(input.title);
  });

  it("updates status and keeps the resolution", () => {
    const { id } = store.create(input);
    store.update(id, "mitigated", "raised memory limit to 1Gi");
    const after = store.update(id, "resolved");
    expect(after?.status).toBe("resolved");
    expect(after?.resolution).toBe("raised memory limit to 1Gi");
  });

  it("returns undefined when updating an unknown id", () => {
    expect(store.update("inc-nope", "resolved")).toBeUndefined();
  });

  it("searches by keyword across signals and lists newest without a query", () => {
    store.create(input);
    store.create({
      ...input,
      title: "dns timeouts",
      signals: ["CoreDNS"],
      summary: "lookups fail"
    });
    expect(store.search("OOMKilled").map((i) => i.title)).toEqual([
      "payments pod OOMKilled"
    ]);
    expect(store.search()).toHaveLength(2);
  });

  it("treats search input as data, not SQL", () => {
    store.create(input);
    expect(store.search("'; DROP TABLE incidents; --")).toEqual([]);
    expect(store.search()).toHaveLength(1);
  });

  describe("timeline", () => {
    it("stores entries with their source and returns the newest oldest-first", () => {
      const { id } = store.create(input);
      store.addEntry(id, "evidence", "Exit Code: 137", "user");
      store.addEntry(id, "hypothesis", "limit too low", "agent");
      store.addEntry(id, "action", "raised limit to 1Gi", "user");
      const t = store.timeline(id, 2);
      expect(t.map((e) => e.kind)).toEqual(["hypothesis", "action"]);
      expect(t[0]?.source).toBe("agent");
    });

    it("rejects entries for unknown incidents", () => {
      expect(store.addEntry("inc-nope", "note", "x", "user")).toBeUndefined();
    });

    it("keeps timelines separate per incident", () => {
      const a = store.create(input);
      const b = store.create(input);
      store.addEntry(a.id, "note", "only a", "user");
      expect(store.timeline(b.id)).toEqual([]);
    });
  });
});
