import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, it, vi } from "vitest";
import type { Message } from "../contracts/conversation-message.type";
import type { ModelCallOptions } from "../contracts/model.contract";
import type { ToolConfig } from "../contracts/tool.contract";
import { extractJsonSchema } from "../utils/json-schema";
import { createToolContext } from "./create-tool-context";
import { tool } from "./tool";
import { compactToolSchemas, measureTools } from "./tool-schemas";

function schemaOf(jsonSchema: Record<string, unknown>): StandardSchemaV1<unknown> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value: unknown) =>
        typeof value === "object" && value !== null
          ? { value }
          : { issues: [{ message: "expected an object" }] },
      jsonSchema: { input: () => jsonSchema, output: () => jsonSchema },
    },
  } as unknown as StandardSchemaV1<unknown>;
}

function makeTool(name: string, descriptionLength: number): ToolConfig<unknown, unknown> {
  return {
    name,
    description: `${name} tool`,
    input: schemaOf({
      type: "object",
      properties: { q: { type: "string", description: "x".repeat(descriptionLength) } },
    }),
    execute: async () => "ok",
  };
}

const tools = [makeTool("alpha", 400), makeTool("beta", 40)];

describe("measureTools — estimate", () => {
  it("estimates per tool and in total when the model has no count endpoint", async () => {
    const result = await measureTools(tools, { model: {} });

    expect(result.source).toBe("estimate");
    expect(result.mode).toBe("full");
    expect(result.overhead).toBe(0);
    expect(result.perTool.map((entry) => entry.name)).toEqual(["alpha", "beta"]);
    const [alpha, beta] = result.perTool;

    expect(result.tokens).toBe((alpha?.tokens ?? 0) + (beta?.tokens ?? 0));
    expect(alpha?.tokens ?? 0).toBeGreaterThan(beta?.tokens ?? 0);
  });

  it("shows the compact saving", async () => {
    const full = await measureTools(tools);
    const compact = await measureTools(tools, { mode: "compact" });

    expect(compact.mode).toBe("compact");
    expect(compact.tokens).toBeLessThan(full.tokens);
  });
});

describe("measureTools — native", () => {
  it("counts baseline, all tools and each leave-one-out variant", async () => {
    // Fake provider: 10 tokens of message, 300 tokens of tool preamble when
    // any tool is present, and 50 / 20 tokens for alpha / beta.
    const sizes: Record<string, number> = { alpha: 50, beta: 20 };
    const countTokens = vi.fn(async (_messages: Message[], options?: ModelCallOptions) => {
      const sent = options?.tools ?? [];
      const toolTokens = sent.reduce((sum, entry) => sum + (sizes[entry.name] ?? 0), 0);

      return 10 + (sent.length > 0 ? 300 : 0) + toolTokens;
    });

    const result = await measureTools(tools, { model: { countTokens }, concurrency: 2 });

    expect(countTokens).toHaveBeenCalledTimes(tools.length + 2);
    expect(result).toEqual({
      tokens: 370,
      perTool: [
        { name: "alpha", tokens: 50 },
        { name: "beta", tokens: 20 },
      ],
      overhead: 300,
      source: "native",
      mode: "full",
    });
  });
});

describe("compactToolSchemas", () => {
  it("sends compact schemas while the tool still validates with the original", async () => {
    const searchTool = tool({
      name: "search",
      description: "Search",
      input: schemaOf({
        type: "object",
        properties: { q: { type: "string", description: "query" } },
      }) as StandardSchemaV1<{ q: string }>,
      execute: async (input: { q: string }) => input.q,
    });

    const [compact] = compactToolSchemas([searchTool]);

    expect(extractJsonSchema(compact?.input)).toEqual({
      type: "object",
      properties: { q: { type: "string" } },
    });
    expect(compact?.description).toBe("Search");
    expect(extractJsonSchema(searchTool.input)).toHaveProperty("properties.q.description");
    expect((await searchTool.invoke("not an object")).error).toBeDefined();
  });
});

describe("createToolContext", () => {
  it("builds the context a tool needs outside the agent loop", async () => {
    const controller = new AbortController();
    const ctx = createToolContext({ signal: controller.signal });
    const recorder = tool({
      name: "recorder",
      description: "Records",
      execute: async (_input: unknown, context) => {
        if (context) {
          context.artifacts.seen = true;
        }

        return context?.signal === controller.signal;
      },
    });

    const result = await recorder.invoke({}, ctx);

    expect(result.data).toBe(true);
    expect(ctx.artifacts).toEqual({ seen: true });
    expect(createToolContext()).toEqual({ artifacts: {} });
    expect(createToolContext({ artifacts: { a: 1 } }).artifacts).toEqual({ a: 1 });
  });
});
