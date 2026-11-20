/**
 * Workaround for duplicated tokens when streaming Llama 3.3 through
 * `workers-ai-provider@3.3.1`.
 *
 * Workers AI streams OpenAI-style chunks that carry everything twice: text in
 * `choices[0].delta.content` and again in the legacy top-level `response`,
 * and tool-call arguments in `choices[0].delta.tool_calls` and again in the
 * top-level `tool_calls`. The provider handles both copies, so tokens show up
 * twice and tool-call JSON is corrupted. We drop the legacy top-level fields
 * whenever `choices[0].delta` is present.
 *
 * Remove this once the provider handles it (check after upgrading).
 */
function dedupeSseTokens(): TransformStream<string, string> {
  let buffer = "";

  const fixEvent = (event: string): string => {
    if (!event.startsWith("data: ") || event === "data: [DONE]") return event;
    try {
      const chunk = JSON.parse(event.slice(6)) as Record<string, unknown>;
      const choices = chunk.choices as Array<{ delta?: unknown }> | undefined;
      if (choices?.[0]?.delta !== undefined) {
        delete chunk.response;
        delete chunk.tool_calls;
      }
      return `data: ${JSON.stringify(chunk)}`;
    } catch {
      return event;
    }
  };

  return new TransformStream({
    transform(text, controller) {
      buffer += text;
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const event of events) controller.enqueue(`${fixEvent(event)}\n\n`);
    },
    flush(controller) {
      if (buffer) controller.enqueue(fixEvent(buffer));
    }
  });
}

/** Wraps the `AI` binding so streamed `run()` results are de-duplicated. */
export function withDedupedStreaming(ai: Ai): Ai {
  return new Proxy(ai, {
    get(target, prop) {
      if (prop !== "run") {
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (...args: unknown[]) => {
        const result: unknown = await (
          target.run as (...a: unknown[]) => Promise<unknown>
        )(...args);
        if (!(result instanceof ReadableStream)) return result;
        return result
          .pipeThrough(new TextDecoderStream())
          .pipeThrough(dedupeSseTokens())
          .pipeThrough(new TextEncoderStream());
      };
    }
  });
}
