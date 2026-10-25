import { afterEach, describe, expect, it, vi } from "vitest";
import {
  describeToolSchemas,
  formatToolSchemaReports,
} from "../../../../../ai/src/tool/tool-schema-lint";
import { aiCommandAction } from "./ai-command.action";
import { aiToolsAction } from "./ai-tools.action";

const api = { describeToolSchemas, formatToolSchemaReports };

function schema(jsonSchema: Record<string, unknown>) {
  return {
    "~standard": { version: 1, vendor: "test", validate: (value: unknown) => ({ value }) },
    jsonSchema,
  };
}

const tools = [
  {
    name: "get_weather",
    description: "Weather by city",
    execute: async () => "sunny",
    input: schema({
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
      additionalProperties: false,
    }),
  },
  {
    name: "save_facts",
    description: "Save facts",
    execute: async () => "ok",
    input: schema({ type: "object", properties: { fact: { type: "string" } } }),
  },
];

const load = vi.fn(async (specifier: string): Promise<Record<string, unknown>> => {
  if (specifier === "@warlock.js/ai") return api;
  if (specifier === "./tools.ts") return { default: tools };
  if (specifier === "./named.ts") return { tools };
  throw new Error(`Unexpected module ${specifier}`);
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("warlock ai tools", () => {
  it("prints each tool with its token estimate and findings, then a total", async () => {
    const stdout = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await aiToolsAction({ args: ["tools"], options: { tools: "./tools.ts" } }, { load });

    const output = stdout.mock.calls.map(([line]) => String(line)).join("\n");

    expect(output).toContain("get_weather  ~");
    expect(output).toContain("save_facts  ~");
    expect(output).toContain("error [openai-strict] properties.fact:");
    expect(output).toMatch(/2 tools, ~\d+ tokens per call, \d+ findings\./);
    expect(load.mock.calls.map(([specifier]) => specifier)).toEqual([
      "@warlock.js/ai",
      "./tools.ts",
    ]);
  });

  it("accepts named tools exports", async () => {
    const stdout = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await aiToolsAction({ args: ["tools"], options: { tools: "./named.ts" } }, { load });

    expect(String(stdout.mock.calls[0]?.[0])).toContain("get_weather");
  });

  it("prints a JSON summary and keeps module progress off stdout", async () => {
    const stdout = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const noisy = vi.fn(async (specifier: string) => {
      console.info("loading", specifier);
      return load(specifier);
    });

    await aiToolsAction(
      { args: ["tools"], options: { tools: "./tools.ts", json: true } },
      { load: noisy },
    );

    expect(stdout).toHaveBeenCalledOnce();
    expect(JSON.parse(String(stdout.mock.calls[0]?.[0]))).toMatchObject({
      tools: [
        { name: "get_weather", ok: true },
        { name: "save_facts", ok: false },
      ],
    });
    expect(stderr).toHaveBeenCalled();
  });

  it("limits the checked providers", async () => {
    const stdout = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await aiToolsAction(
      { args: ["tools"], options: { tools: "./tools.ts", targets: "anthropic", json: true } },
      { load },
    );

    expect(JSON.parse(String(stdout.mock.calls[0]?.[0]))).toMatchObject({
      issueCount: 0,
      tools: [{ targets: ["anthropic"] }, { targets: ["anthropic"] }],
    });
  });

  it("exits 1 with --fail when a tool has an error-level finding", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await aiToolsAction({ args: ["tools"], options: { tools: "./tools.ts" } }, { load });
    expect(process.exitCode).toBeUndefined();

    await aiToolsAction(
      { args: ["tools"], options: { tools: "./tools.ts", fail: true } },
      { load },
    );
    expect(process.exitCode).toBe(1);
  });

  it("rejects missing or malformed input before loading modules", async () => {
    const quiet = vi.fn(load);

    await expect(aiToolsAction({ args: ["tools"], options: {} }, { load: quiet })).rejects.toThrow(
      "Usage: warlock ai tools",
    );
    await expect(
      aiToolsAction(
        { args: ["tools"], options: { tools: "./tools.ts", targets: "azure" } },
        { load: quiet },
      ),
    ).rejects.toThrow("Unknown --targets azure");
    await expect(
      aiToolsAction(
        { args: ["tools"], options: { tools: "./tools.ts", warnAbove: "lots" } },
        { load: quiet },
      ),
    ).rejects.toThrow("--warn-above");
    expect(quiet).not.toHaveBeenCalled();
  });

  it("explains a missing or outdated @warlock.js/ai and a bad tools export", async () => {
    await expect(
      aiToolsAction(
        { args: ["tools"], options: { tools: "./tools.ts" } },
        {
          load: async () => {
            throw new Error("not found");
          },
        },
      ),
    ).rejects.toThrow("Install it in this project");
    await expect(
      aiToolsAction(
        { args: ["tools"], options: { tools: "./tools.ts" } },
        { load: async () => ({}) },
      ),
    ).rejects.toThrow("5.38.0 or newer");
    await expect(
      aiToolsAction(
        { args: ["tools"], options: { tools: "./tools.ts" } },
        {
          load: async (specifier) =>
            specifier === "@warlock.js/ai" ? api : { default: [{ name: 1 }] },
        },
      ),
    ).rejects.toThrow("array of tool configs");
  });

  it("is reached through aiCommandAction", async () => {
    const stdout = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await aiCommandAction({ args: ["tools"], options: { tools: "./tools.ts" } }, { load });

    expect(String(stdout.mock.calls[0]?.[0])).toContain("get_weather");
  });
});
