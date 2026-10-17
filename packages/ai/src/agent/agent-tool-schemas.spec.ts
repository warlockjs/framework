import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, it } from "vitest";
import { MockSDK } from "../mock/mock-sdk";
import { tool } from "../tool/tool";
import { extractJsonSchema } from "../utils/json-schema";
import { agent } from "./agent";

const searchTool = tool({
  name: "search",
  description: "Search the catalog",
  input: {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value: unknown) => ({ value }),
      jsonSchema: {
        input: () => ({
          type: "object",
          properties: { query: { type: "string", description: "What to look for" } },
        }),
        output: () => ({}),
      },
    },
  } as unknown as StandardSchemaV1<{ query: string }>,
  execute: async (input: { query: string }) => input.query,
});

function sentSchema(mock: ReturnType<typeof MockSDK>): Record<string, unknown> | undefined {
  const call = mock.models[0]?.callHistory[0];

  return extractJsonSchema(call?.options?.tools?.[0]?.input);
}

describe("agent toolSchemas", () => {
  it("sends full schemas by default", async () => {
    const mock = MockSDK({ responses: [{ content: "done", finishReason: "stop" }] });

    await agent({ model: mock.model({ name: "m" }), tools: [searchTool] }).execute("hi");

    expect(sentSchema(mock)).toHaveProperty("properties.query.description");
  });

  it("sends compact schemas when configured, per agent or per call", async () => {
    const configured = MockSDK({ responses: [{ content: "done", finishReason: "stop" }] });
    await agent({
      model: configured.model({ name: "m" }),
      tools: [searchTool],
      toolSchemas: "compact",
    }).execute("hi");

    expect(sentSchema(configured)).toEqual({
      type: "object",
      properties: { query: { type: "string" } },
    });

    const perCall = MockSDK({ responses: [{ content: "done", finishReason: "stop" }] });
    await agent({ model: perCall.model({ name: "m" }), tools: [searchTool] }).execute("hi", {
      toolSchemas: "compact",
    });

    expect(sentSchema(perCall)).not.toHaveProperty("properties.query.description");
  });
});
