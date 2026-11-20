import { isReadOnly } from "./diagnosis";

const FENCE = /```([\w-]*)\n([\s\S]*?)```/g;

/** Lines that are actual commands (not blank, not comments). */
const commandLines = (code: string): string[] =>
  code
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

/**
 * Adds a visible label above every fenced block that contains kubectl
 * commands: read-only, or "changes the cluster". We decide this ourselves
 * rather than trusting the model's own label. Unclosed (still streaming)
 * fences are left alone.
 */
export function flagCommandBlocks(markdown: string): string {
  return markdown.replace(FENCE, (block, _lang: string, code: string) => {
    const lines = commandLines(code).filter((l) => /^kubectl\s/.test(l));
    if (lines.length === 0) return block;
    const label = lines.every(isReadOnly)
      ? "> ✓ **Read-only**\n\n"
      : "> ⚠️ **Changes the cluster.** Review before running.\n\n";
    return `${label}${block}`;
  });
}
