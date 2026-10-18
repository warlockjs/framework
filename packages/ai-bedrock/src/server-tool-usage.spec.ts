import { ConverseStreamCommand, type BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { describe, expect, it } from "vitest";
import { BedrockModel } from "./model";

const toolUse = {
  type: "server_tool_use",
  toolUseId: "hosted",
  name: "nova_grounding",
  input: { query: "news" },
};
const usage = { inputTokens: 10, outputTokens: 2, totalTokens: 12 };
const send = async (command: unknown) =>
  command instanceof ConverseStreamCommand
    ? {
        stream: (async function* () {
          yield { contentBlockStart: { contentBlockIndex: 0, start: { toolUse } } };
          yield { contentBlockStop: { contentBlockIndex: 0 } };
          yield { messageStop: { stopReason: "end_turn" } };
          yield { metadata: { usage } };
        })(),
      }
    : {
        output: { message: { role: "assistant", content: [{ toolUse }] } },
        stopReason: "end_turn",
        usage,
      };
function model() {
  return new BedrockModel({ send } as unknown as BedrockRuntimeClient, {
    name: "amazon.nova-pro-v1:0",
    pricing: { input: 0, output: 0, serverTools: { webSearch: 1 } },
  });
}

describe("Converse hosted-tool accounting", () => {
  it("does not fabricate search requests from hosted blocks in completions", async () => {
    const response = await model().complete([{ role: "user", content: "search" }]);
    expect(response.toolCalls).toBeUndefined();
    expect(response.usage.serverToolUse).toBeUndefined();
    expect(response.usage.cost?.serverTools).toBeUndefined();
  });

  it("leaves hosted request counts unreported in streams", async () => {
    const chunks = [];
    for await (const chunk of model().stream([{ role: "user", content: "search" }], {
      streamChunks: true,
    }))
      chunks.push(chunk);
    expect(chunks.some((chunk) => chunk.type === "tool-call" || chunk.type === "tool-args")).toBe(
      false,
    );
    expect(chunks.find((chunk) => chunk.type === "done")?.usage.serverToolUse).toBeUndefined();
  });
});
