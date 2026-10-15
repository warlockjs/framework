import type { ToolConfig } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import { toBedrockToolConfig } from "./to-bedrock-tools";

function schemaTool(name: string, jsonSchema: Record<string, unknown>): ToolConfig<unknown, unknown> {
  return {
    name,
    description: `${name} tool`,
    input: {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: (value: unknown) => ({ value }),
        jsonSchema: { input: () => jsonSchema },
      },
    } as unknown as ToolConfig<unknown, unknown>["input"],
    execute: async (value: unknown) => value,
  };
}

describe("toBedrockToolConfig", () => {
  it("returns undefined for empty / missing tool lists", () => {
    expect(toBedrockToolConfig(undefined)).toBeUndefined();
    expect(toBedrockToolConfig([])).toBeUndefined();
  });

  it("maps tools into toolSpec entries with a JSON input schema", () => {
    const objectSchema = {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    };

    expect(toBedrockToolConfig([schemaTool("getWeather", objectSchema)])).toEqual({
      tools: [
        {
          toolSpec: {
            name: "getWeather",
            description: "getWeather tool",
            inputSchema: { json: objectSchema },
          },
        },
      ],
    });
  });

  it("degrades a non-object schema to a parameterless object schema", () => {
    const config = toBedrockToolConfig([
      schemaTool("listAll", { type: "array", items: { type: "string" } }),
    ]);

    expect(config?.tools?.[0].toolSpec?.inputSchema).toEqual({ json: { type: "object" } });
  });

  it("degrades to a parameterless object schema when extraction yields nothing", () => {
    // An input with no recognizable schema path → extractJsonSchema returns
    // undefined → toJsonSchema falls back to { type: "object" }.
    const noSchemaTool: ToolConfig<unknown, unknown> = {
      name: "bare",
      description: "bare tool",
      input: {} as ToolConfig<unknown, unknown>["input"],
      execute: async (value: unknown) => value,
    };

    expect(toBedrockToolConfig([noSchemaTool])?.tools?.[0].toolSpec?.inputSchema).toEqual({
      json: { type: "object" },
    });
  });

  it("maps several tools, preserving order and each description", () => {
    const objectSchema = { type: "object", properties: {} };
    const config = toBedrockToolConfig([
      schemaTool("alpha", objectSchema),
      schemaTool("beta", objectSchema),
    ]);

    expect(config?.tools).toHaveLength(2);
    expect(config?.tools?.[0].toolSpec?.name).toBe("alpha");
    expect(config?.tools?.[0].toolSpec?.description).toBe("alpha tool");
    expect(config?.tools?.[1].toolSpec?.name).toBe("beta");
    expect(config?.tools?.[1].toolSpec?.description).toBe("beta tool");
  });

  it("forwards an undefined description verbatim", () => {
    const tool: ToolConfig<unknown, unknown> = {
      name: "noDesc",
      description: undefined as unknown as string,
      input: {} as ToolConfig<unknown, unknown>["input"],
      execute: async (value: unknown) => value,
    };

    expect(toBedrockToolConfig([tool])?.tools?.[0].toolSpec?.description).toBeUndefined();
  });
});
