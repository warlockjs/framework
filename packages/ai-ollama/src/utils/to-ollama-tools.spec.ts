import type { ToolConfig } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import { toOllamaTools } from "./to-ollama-tools";

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

describe("toOllamaTools", () => {
  it("returns undefined for empty / missing tool lists", () => {
    expect(toOllamaTools(undefined)).toBeUndefined();
    expect(toOllamaTools([])).toBeUndefined();
  });

  it("maps tools into Ollama function entries", () => {
    const objectSchema = {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    };

    expect(toOllamaTools([schemaTool("getWeather", objectSchema)])).toEqual([
      {
        type: "function",
        function: {
          name: "getWeather",
          description: "getWeather tool",
          parameters: objectSchema,
        },
      },
    ]);
  });

  it("degrades a non-object schema to a parameterless object schema", () => {
    const tools = toOllamaTools([schemaTool("listAll", { type: "array" })]);

    expect(tools?.[0].function.parameters).toEqual({ type: "object" });
  });

  it("degrades to a parameterless object schema when extraction yields nothing", () => {
    const unextractable: ToolConfig<unknown, unknown> = {
      name: "opaque",
      description: "no standard slot",
      input: {} as unknown as ToolConfig<unknown, unknown>["input"],
      execute: async (value: unknown) => value,
    };

    const tools = toOllamaTools([unextractable]);

    expect(tools?.[0].function.parameters).toEqual({ type: "object" });
  });

  it("maps several tools preserving order and forwards an undefined description", () => {
    const objectSchema = { type: "object", properties: {} };
    const withoutDescription: ToolConfig<unknown, unknown> = {
      name: "bare",
      description: undefined as unknown as string,
      input: {
        "~standard": {
          version: 1,
          vendor: "test",
          validate: (value: unknown) => ({ value }),
          jsonSchema: { input: () => objectSchema },
        },
      } as unknown as ToolConfig<unknown, unknown>["input"],
      execute: async (value: unknown) => value,
    };

    const tools = toOllamaTools([schemaTool("first", objectSchema), withoutDescription]);

    expect(tools).toEqual([
      {
        type: "function",
        function: { name: "first", description: "first tool", parameters: objectSchema },
      },
      {
        type: "function",
        function: { name: "bare", description: undefined, parameters: objectSchema },
      },
    ]);
  });
});
