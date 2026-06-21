import type { ToolConfig } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import { toGoogleTools } from "./to-google-tools";

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

describe("toGoogleTools", () => {
  it("returns undefined for empty / missing tool lists", () => {
    expect(toGoogleTools(undefined)).toBeUndefined();
    expect(toGoogleTools([])).toBeUndefined();
  });

  it("wraps all tools in a single Tool with functionDeclarations", () => {
    const objectSchema = {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    };

    expect(toGoogleTools([schemaTool("getWeather", objectSchema)])).toEqual([
      {
        functionDeclarations: [
          {
            name: "getWeather",
            description: "getWeather tool",
            parametersJsonSchema: objectSchema,
          },
        ],
      },
    ]);
  });

  it("degrades a non-object schema to a parameterless object schema", () => {
    const tools = toGoogleTools([schemaTool("listAll", { type: "array" })]);

    expect(tools?.[0].functionDeclarations?.[0].parametersJsonSchema).toEqual({ type: "object" });
  });

  it("packs multiple tools into the single Tool's functionDeclarations array", () => {
    const tools = toGoogleTools([
      schemaTool("getWeather", { type: "object", properties: { city: { type: "string" } } }),
      schemaTool("getTime", { type: "object", properties: { tz: { type: "string" } } }),
    ]);

    expect(tools).toHaveLength(1);
    expect(tools?.[0].functionDeclarations).toHaveLength(2);
    expect(tools?.[0].functionDeclarations?.map((declaration) => declaration.name)).toEqual([
      "getWeather",
      "getTime",
    ]);
  });

  it("degrades to a parameterless object schema when extraction yields nothing", () => {
    const tool: ToolConfig<unknown, unknown> = {
      name: "noSchema",
      description: "no schema tool",
      // No `~standard` / jsonSchema path — extractJsonSchema returns undefined.
      input: {} as unknown as ToolConfig<unknown, unknown>["input"],
      execute: async (value: unknown) => value,
    };

    expect(toGoogleTools([tool])?.[0].functionDeclarations?.[0].parametersJsonSchema).toEqual({
      type: "object",
    });
  });
});
