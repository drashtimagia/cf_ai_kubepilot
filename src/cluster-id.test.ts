import { describe, expect, it } from "vitest";
import { resolveClusterId } from "./cluster-id";

const random = () => "ws-random01";

describe("resolveClusterId", () => {
  it("prefers a valid ?cluster= over storage", () => {
    expect(
      resolveClusterId({
        search: "?cluster=prod-eu",
        stored: "ws-old12345",
        random
      })
    ).toBe("prod-eu");
  });
  it("uses the stored workspace when there is no query", () => {
    expect(
      resolveClusterId({ search: "", stored: "ws-old12345", random })
    ).toBe("ws-old12345");
  });
  it("generates a private workspace for a first visit", () => {
    expect(resolveClusterId({ search: "", stored: null, random })).toBe(
      "ws-random01"
    );
  });
  it("ignores invalid ids from the URL or storage", () => {
    expect(
      resolveClusterId({ search: "?cluster=../../x", stored: "BAD ID", random })
    ).toBe("ws-random01");
  });
});
