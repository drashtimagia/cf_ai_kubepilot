import type { UIMessage } from "ai";
import { parseK8sOutput } from "./k8s-parse";
import { MAX_HISTORY_MESSAGES, truncateMiddle } from "./limits";

/** Plain text of each user message, oldest first. */
export const userTexts = (messages: UIMessage[]): string[] =>
  messages
    .filter((m) => m.role === "user")
    .map((m) =>
      m.parts
        .map((p) => (p.type === "text" ? p.text : ""))
        .join("\n")
        .trim()
    );

/**
 * The text a diagnosis or parse should look at: the newest user message that
 * contains recognizable kubectl output, else just the newest message.
 */
export function evidenceText(messages: UIMessage[]): string {
  const texts = userTexts(messages).reverse();
  return (
    texts.find((t) => parseK8sOutput(t).kind !== "unknown") ?? texts[0] ?? ""
  );
}

/** Truncates pasted logs in what we send to the model (stored chat is untouched). */
export function limitMessageText(messages: UIMessage[]): UIMessage[] {
  return messages.slice(-MAX_HISTORY_MESSAGES).map((m) => ({
    ...m,
    parts: m.parts.map((p) =>
      p.type === "text" ? { ...p, text: truncateMiddle(p.text) } : p
    )
  }));
}
