import { describe, expect, it } from "vitest";
import { withDedupedStreaming } from "./ai-binding";

const event = (chunk: object) => `data: ${JSON.stringify(chunk)}\n\n`;

/** Fake `AI` binding whose streamed `run()` splits the body mid-event. */
function fakeAi(body: string): Ai {
  const bytes = new TextEncoder().encode(body);
  return {
    run: async () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.slice(0, 40));
          controller.enqueue(bytes.slice(40));
          controller.close();
        }
      }),
    gateway: () => "gw"
  } as unknown as Ai;
}

async function readAll(stream: ReadableStream): Promise<string> {
  return new Response(stream).text();
}

const parse = (text: string) =>
  text
    .split("\n\n")
    .filter((e) => e.startsWith("data: ") && !e.includes("[DONE]"))
    .map((e) => JSON.parse(e.slice(6)) as Record<string, unknown>);

describe("withDedupedStreaming", () => {
  it("drops the duplicated response and tool_calls fields", async () => {
    const toolCall = { index: 0, function: { arguments: '{"a":1}' } };
    const body =
      event({
        choices: [{ delta: { content: "Hello" } }],
        response: "Hello",
        tool_calls: []
      }) +
      event({
        choices: [{ delta: { tool_calls: [toolCall] } }],
        response: "",
        tool_calls: [toolCall]
      }) +
      "data: [DONE]\n\n";

    const ai = withDedupedStreaming(fakeAi(body));
    const out = (await ai.run("m" as never, {} as never)) as ReadableStream;
    const chunks = parse(await readAll(out));

    expect(chunks).toHaveLength(2);
    for (const chunk of chunks) {
      expect(chunk).not.toHaveProperty("response");
      expect(chunk).not.toHaveProperty("tool_calls");
    }
    expect(chunks[0]?.choices).toEqual([{ delta: { content: "Hello" } }]);
    expect(chunks[1]?.choices).toEqual([{ delta: { tool_calls: [toolCall] } }]);
  });

  it("keeps response when the chunk has no choices delta (older format)", async () => {
    const body = event({ response: "Hi" });
    const ai = withDedupedStreaming(fakeAi(body));
    const out = (await ai.run("m" as never, {} as never)) as ReadableStream;
    expect(parse(await readAll(out))).toEqual([{ response: "Hi" }]);
  });

  it("passes non-stream results and other binding members through", async () => {
    const raw = {
      run: async () => ({ response: "plain" }),
      gateway: () => "gw"
    } as unknown as Ai;
    const ai = withDedupedStreaming(raw);
    expect(await ai.run("m" as never, {} as never)).toEqual({
      response: "plain"
    });
    expect((ai as unknown as { gateway: () => string }).gateway()).toBe("gw");
  });
});
