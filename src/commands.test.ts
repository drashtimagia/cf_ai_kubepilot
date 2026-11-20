import { describe, expect, it } from "vitest";
import { flagCommandBlocks } from "./commands";

const block = (cmd: string) => "```bash\n" + cmd + "\n```";

describe("flagCommandBlocks", () => {
  it("labels read-only kubectl blocks", () => {
    const out = flagCommandBlocks(
      `Run:\n\n${block("# read-only\nkubectl logs p -n x --previous")}`
    );
    expect(out).toContain("✓ **Read-only**");
  });
  it("flags blocks that change the cluster, even if the model said read-only", () => {
    const out = flagCommandBlocks(
      block("# read-only\nkubectl delete pod p -n x")
    );
    expect(out).toContain("Changes the cluster");
    expect(out).not.toContain("✓");
  });
  it("flags a mixed block as changing the cluster", () => {
    expect(
      flagCommandBlocks(
        block("kubectl get pods\nkubectl rollout restart deploy/a")
      )
    ).toContain("Changes the cluster");
  });
  it("leaves non-kubectl blocks and still-streaming fences alone", () => {
    expect(flagCommandBlocks(block("echo hi"))).toBe(block("echo hi"));
    const open = "```bash\nkubectl delete pod p";
    expect(flagCommandBlocks(open)).toBe(open);
  });
});
