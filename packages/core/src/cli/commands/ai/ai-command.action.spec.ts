import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Message, ModelCallOptions } from "@warlock.js/ai";
import type { CommandActionData } from "../../../commands/types";
import { measure } from "../../../../../ai/src/measure/measure";
import { MockModel } from "../../../../../ai/src/mock/mock-model";
import { skills } from "../../../../../ai/src/skills/skills";
import { aiCommandAction, formatMeasurement, resolveMeasureModel } from "./ai-command.action";

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const model = Object.assign(new MockModel("fixture", [], undefined, { input: 2, output: 5 }), {
  countTokens: vi.fn(
    async (messages: Message[], options?: ModelCallOptions) =>
      messages.reduce(
        (sum: number, message: { content: unknown }) => sum + String(message.content).length + 4,
        0,
      ) +
      (options?.tools?.length ?? 0) * 25,
  ),
});

// No provider SDK is imported; native counts come from the mock above.
const api = { measure, skills };

describe("warlock ai measure", () => {
  it("loads modules lazily and prints a clean JSON report with file and catalogue inputs", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ai-measure-"));
    directories.push(cwd);
    await mkdir(path.join(cwd, "skills", "support"), { recursive: true });
    await writeFile(path.join(cwd, "system.txt"), "Help the user");
    await writeFile(
      path.join(cwd, "skills", "support", "SKILL.md"),
      "---\ndescription: Support advice\n---\nPrivate skill body is loaded on demand.",
    );
    const execute = vi.fn(async () => "unused");
    const tool = {
      name: "lookup",
      description: "Look up an item",
      execute,
      input: {
        "~standard": { version: 1, vendor: "test", validate: (value: unknown) => ({ value }) },
      },
    };
    const load = vi.fn(async (specifier: string): Promise<Record<string, unknown>> => {
      console.info("module progress");
      if (specifier === "@warlock.js/ai") return api;
      if (specifier === "./models.ts")
        return {
          resolveModel: (id: string) => {
            expect(id).toBe("fixture");
            return model;
          },
        };
      if (specifier === "./tools.ts") return { default: [tool] };
      throw new Error(`Unexpected module ${specifier}`);
    });
    const stdout = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await aiCommandAction(
      {
        args: ["measure"],
        options: {
          model: "fixture",
          modelModule: "./models.ts",
          tools: "./tools.ts",
          system: "system.txt",
          skills: "skills",
          json: true,
        },
      },
      { cwd, load },
    );
    expect(stdout).toHaveBeenCalledOnce();
    const json: unknown = JSON.parse(String(stdout.mock.calls[0]?.[0]));
    expect(json).toMatchObject({
      model: "fixture",
      probe: true,
      parts: { system: { source: "native" }, tools: { tokens: 25 }, skills: { source: "native" } },
    });
    expect(stderr).toHaveBeenCalledWith("module progress");
    expect(String(stdout.mock.calls[0]?.[0])).not.toContain("Private skill body");
    expect(load.mock.calls.map(([specifier]) => specifier)).toEqual([
      "@warlock.js/ai",
      "./models.ts",
      "./tools.ts",
    ]);
    expect(execute).not.toHaveBeenCalled();
    expect(model.callCount).toBe(0);
  });

  it("accepts named tools exports and prints the human summary", async () => {
    const stdout = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const load = async (specifier: string) =>
      specifier === "@warlock.js/ai"
        ? api
        : specifier === "./tools.ts"
          ? { tools: [] }
          : { default: model };
    await aiCommandAction(
      {
        args: ["measure"],
        options: { model: "fixture", modelModule: "./model.ts", tools: "./tools.ts" },
      },
      { load },
    );
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining("USD uses uncached input pricing"));
    const report = await measure({ model: new MockModel("offline", []) });
    expect(formatMeasurement(report)).toContain("estimate\tunknown");
    expect(formatMeasurement(report)).toContain('user probe: "."');
  });

  it("resolves provider IDs through verified SDK factories without real calls", async () => {
    const configs: unknown[] = [];
    const modelConfigs: unknown[] = [];
    class SDK {
      constructor(config: unknown) {
        configs.push(config);
      }
      model(config: unknown) {
        modelConfigs.push(config);
        return model;
      }
    }
    const load = vi.fn(async () => ({ OpenAISDK: SDK, AnthropicSDK: SDK, GoogleSDK: SDK }));
    const env = { OPENAI_API_KEY: "test", ANTHROPIC_API_KEY: "test", GEMINI_API_KEY: "test" };
    await resolveMeasureModel("sample", undefined, load, env);
    await resolveMeasureModel("anthropic:sample", undefined, load, env);
    await resolveMeasureModel("google:sample", undefined, load, env);
    expect(load.mock.calls).toEqual([
      ["@warlock.js/ai-openai"],
      ["@warlock.js/ai-anthropic"],
      ["@warlock.js/ai-google"],
    ]);
    expect(modelConfigs).toEqual([
      { name: "sample", api: "responses" },
      { name: "sample" },
      { name: "sample" },
    ]);
    expect(configs).toEqual([{ apiKey: "test" }, { apiKey: "test" }, { apiKey: "test" }]);
  });

  it("reports missing AI and provider packages with install guidance", async () => {
    const load = vi.fn(async () => {
      throw new Error("missing");
    });
    await expect(
      aiCommandAction({ args: ["measure"], options: { model: "sample" } }, { load }),
    ).rejects.toThrow("Install it in this project");
    await expect(
      resolveMeasureModel("sample", undefined, load, { OPENAI_API_KEY: "test" }),
    ).rejects.toThrow("Install it in this project");
    await expect(resolveMeasureModel("sample", undefined, load, {})).rejects.toThrow(
      "OPENAI_API_KEY",
    );
    await expect(resolveMeasureModel("unknown:sample", undefined, load, {})).rejects.toThrow(
      "custom provider",
    );
  });

  it.each<CommandActionData>([
    { args: ["unknown"], options: { model: "sample" } },
    { args: ["measure"], options: {} },
    { args: ["measure"], options: { model: true } },
    { args: ["measure"], options: { model: "sample", tools: true } },
  ])("rejects malformed inputs before loading modules", async (data) => {
    const load = vi.fn(async () => api);
    await expect(aiCommandAction(data, { load })).rejects.toThrow();
    expect(load).not.toHaveBeenCalled();
  });

  it("rejects invalid tool exports and missing skills directories", async () => {
    const load = async (specifier: string) =>
      specifier === "@warlock.js/ai"
        ? api
        : specifier === "./tools.ts"
          ? { tools: ["bad"] }
          : { default: model };
    await expect(
      aiCommandAction(
        {
          args: ["measure"],
          options: { model: "fixture", modelModule: "./model.ts", tools: "./tools.ts" },
        },
        { load },
      ),
    ).rejects.toThrow("array of tool configs");
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ai-measure-"));
    directories.push(cwd);
    await expect(
      aiCommandAction(
        {
          args: ["measure"],
          options: { model: "fixture", modelModule: "./model.ts", skills: "missing" },
        },
        { load, cwd },
      ),
    ).rejects.toThrow();
  });

  it("restores console logging and propagates provider errors", async () => {
    const error = new Error("provider unavailable");
    const failingModel = Object.assign(new MockModel("failed", []), {
      countTokens: async () => {
        throw error;
      },
    });
    const log = console.log;
    const load = async (specifier: string) =>
      specifier === "@warlock.js/ai" ? api : { model: failingModel };
    await expect(
      aiCommandAction(
        { args: ["measure"], options: { model: "failed", modelModule: "./model.ts", json: true } },
        { load },
      ),
    ).rejects.toBe(error);
    expect(console.log).toBe(log);
  });
});
