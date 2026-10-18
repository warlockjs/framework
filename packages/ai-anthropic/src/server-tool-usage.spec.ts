import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { AnthropicModel } from "./model";
import { ANTHROPIC_SERVER_TOOL_PRICING } from "./known-pricing";

const content = [
  { type: "server_tool_use", id: "search", name: "web_search", input: { query: "news" } },
  { type: "web_search_tool_result", tool_use_id: "search", content: [] },
];
const usage = {
  input_tokens: 1,
  output_tokens: 1,
  server_tool_use: { web_search_requests: 2, web_fetch_requests: 0 },
};
function model(streaming = false) {
  const create = async () =>
    streaming
      ? (async function* () {
          yield { type: "message_start", message: { usage } };
          for (const [index, block] of content.entries()) {
            yield { type: "content_block_start", index, content_block: block };
            if (index === 0)
              yield {
                type: "content_block_delta",
                index,
                delta: { type: "input_json_delta", partial_json: '{"query":"news"}' },
              };
            yield { type: "content_block_stop", index };
          }
          yield { type: "message_delta", delta: { stop_reason: "end_turn" }, usage };
          yield { type: "message_delta", delta: { stop_reason: "end_turn" }, usage };
        })()
      : { content, usage, stop_reason: "end_turn" };
  return new AnthropicModel({ messages: { create } } as unknown as Anthropic, {
    name: "claude-sonnet-4-6",
    pricing: { input: 0, output: 0, serverTools: ANTHROPIC_SERVER_TOOL_PRICING },
  });
}

describe("Anthropic hosted usage", () => {
  it("uses provider counters and retains hosted blocks on complete", async () => {
    const result = await model().complete([{ role: "user", content: "search" }]);
    expect(result.usage.serverToolUse).toEqual({ webSearchRequests: 2, webFetchRequests: 0 });
    expect(result.usage.cost?.serverTools).toEqual({ webSearch: 0.02, webFetch: 0 });
    expect(result.blocks?.map((block) => block.data)).toEqual(content);
    expect(result.toolCalls).toBeUndefined();
  });

  it("replaces cumulative message_delta counts and never emits hosted tool calls", async () => {
    const chunks = [];
    for await (const chunk of model(true).stream([{ role: "user", content: "search" }], {
      streamChunks: true,
    }))
      chunks.push(chunk);
    expect(chunks.some((chunk) => chunk.type === "tool-call" || chunk.type === "tool-args")).toBe(
      false,
    );
    const done = chunks.find((chunk) => chunk.type === "done");
    expect(done?.usage.serverToolUse).toEqual({ webSearchRequests: 2, webFetchRequests: 0 });
    expect(done?.usage.cost?.serverTools?.webSearch).toBe(0.02);
    expect(done?.blocks?.map((block) => block.data)).toEqual(content);
  });
});
