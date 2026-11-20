import { describe, expect, it } from "vitest";
import { friendlyError } from "./errors";

describe("friendlyError", () => {
  it("explains rate limits and capacity errors", () => {
    expect(friendlyError(new Error("429 Too Many Requests"))).toMatch(
      /rate limited/
    );
    expect(
      friendlyError(new Error("3040: Capacity temporarily exceeded"))
    ).toMatch(/rate limited/);
  });
  it("explains oversized input", () => {
    expect(friendlyError(new Error("maximum context length exceeded"))).toMatch(
      /too large/
    );
  });
  it("explains timeouts", () => {
    expect(friendlyError("request timed out")).toMatch(/too long/);
  });
  it("never leaks the raw error", () => {
    expect(
      friendlyError(new Error("secret internal reference=abc123"))
    ).not.toContain("abc123");
  });
});
