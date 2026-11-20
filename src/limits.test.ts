import { describe, expect, it } from "vitest";
import { truncateMiddle } from "./limits";

describe("truncateMiddle", () => {
  it("leaves short text alone", () => {
    expect(truncateMiddle("hello", 100)).toBe("hello");
  });

  it("keeps head and tail and reports what was dropped", () => {
    const text = `HEAD${"x".repeat(500)}TAIL`;
    const out = truncateMiddle(text, 100);
    expect(out.startsWith("HEAD")).toBe(true);
    expect(out.endsWith("TAIL")).toBe(true);
    expect(out).toContain("characters truncated");
    expect(out.length).toBeLessThan(text.length);
  });
});
