import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { fixture } from "./fixtures";
import { MAX_HISTORY_MESSAGES, MAX_TEXT_CHARS } from "./limits";
import { evidenceText, limitMessageText, userTexts } from "./messages";

const msg = (role: "user" | "assistant", text: string, i = 0): UIMessage => ({
  id: `m${i}`,
  role,
  parts: [{ type: "text", text }]
});

describe("evidenceText", () => {
  it("picks the newest message with kubectl output, not just the newest message", () => {
    const messages = [
      msg("user", fixture("crashloop-describe"), 1),
      msg("assistant", "Let me look.", 2),
      msg("user", "run diagnosis please", 3)
    ];
    expect(evidenceText(messages)).toContain("CrashLoopBackOff");
  });
  it("falls back to the newest user message", () => {
    expect(
      evidenceText([msg("user", "hello", 1), msg("user", "my pod is sad", 2)])
    ).toBe("my pod is sad");
  });
  it("is empty when there are no user messages", () => {
    expect(evidenceText([msg("assistant", "hi")])).toBe("");
  });
});

describe("userTexts", () => {
  it("returns only user text", () => {
    expect(userTexts([msg("user", "a", 1), msg("assistant", "b", 2)])).toEqual([
      "a"
    ]);
  });
});

describe("limitMessageText", () => {
  it("keeps only recent messages and truncates huge pastes", () => {
    const many = Array.from({ length: MAX_HISTORY_MESSAGES + 10 }, (_, i) =>
      msg("user", "x", i)
    );
    expect(limitMessageText(many)).toHaveLength(MAX_HISTORY_MESSAGES);

    const huge = limitMessageText([
      msg("user", "y".repeat(MAX_TEXT_CHARS * 3))
    ]);
    const part = huge[0]!.parts[0]!;
    expect(part.type === "text" && part.text.length).toBeLessThan(
      MAX_TEXT_CHARS + 200
    );
    expect(part.type === "text" && part.text).toContain("characters truncated");
  });
  it("does not mutate the stored messages", () => {
    const original = [msg("user", "y".repeat(MAX_TEXT_CHARS * 2))];
    limitMessageText(original);
    expect((original[0]!.parts[0] as { text: string }).text.length).toBe(
      MAX_TEXT_CHARS * 2
    );
  });
});
