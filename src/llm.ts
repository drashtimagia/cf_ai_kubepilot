import { generateText } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { MAX_OUTPUT_TOKENS, MODEL } from "./model";

/**
 * One non-streaming, JSON-only model call. Shared by the Workflow and the
 * evaluation harness so both exercise the same prompt wrapper.
 */
export async function askModel(
  ai: Ai,
  system: string,
  prompt: string
): Promise<string> {
  const { text, finishReason } = await generateText({
    model: createWorkersAI({ binding: ai })(MODEL),
    system: `${system}\nRespond with ONLY the JSON object, no prose, no code fences.`,
    prompt,
    temperature: 0.2,
    maxOutputTokens: MAX_OUTPUT_TOKENS
  });
  if (finishReason === "length") {
    throw new Error("Model output was cut off at the token limit");
  }
  return text;
}
