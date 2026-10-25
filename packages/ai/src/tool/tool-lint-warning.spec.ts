import type { StandardSchemaV1 } from "@standard-schema/spec";
import { log } from "@warlock.js/logger";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAIConfig } from "../config";
import type { ToolConfig } from "../contracts/tool.contract";
import { resetToolLintWarnings } from "./tool-lint-warning";
import { tool } from "./tool";

function fixed(schema: Record<string, unknown>): StandardSchemaV1<unknown> {
  return {
    "~standard": { version: 1, vendor: "test", validate: (value: unknown) => ({ value }) },
    jsonSchema: schema,
  } as unknown as StandardSchemaV1<unknown>;
}

const looseSchema = fixed({
  type: "object",
  properties: { a: { type: "string" } },
});

function define(name = "save_facts", extra: Partial<ToolConfig<unknown, string>> = {}) {
  return tool<unknown, string>({
    name,
    description: "Save facts",
    input: looseSchema,
    execute: async () => "ok",
    ...extra,
  });
}

describe("ai.tool() definition-time schema warning", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetToolLintWarnings();
    warn = vi.spyOn(log, "warn").mockImplementation(() => undefined as never);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VITEST", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    setAIConfig({ toolLint: undefined });
  });

  it("warns once per tool definition with the findings and token estimate", () => {
    define();
    define();

    expect(warn).toHaveBeenCalledTimes(1);

    const [module, action, message, context] = warn.mock.calls[0] as [
      string,
      string,
      string,
      { tool: string; tokens: number; issues: string[] },
    ];

    expect(module).toBe("ai.tool");
    expect(action).toBe("schema.lint");
    expect(message).toContain('tool "save_facts"');
    expect(context.tool).toBe("save_facts");
    expect(context.tokens).toBeGreaterThan(0);
    expect(context.issues.some((issue) => issue.includes("additionalProperties"))).toBe(true);
  });

  it("warns again when the definition changes", () => {
    define();
    define("save_facts", { description: "Save lasting facts" });

    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("stays quiet for a clean tool", () => {
    tool({
      name: "clean",
      description: "Clean",
      input: fixed({
        type: "object",
        properties: { a: { type: "string" } },
        required: ["a"],
        additionalProperties: false,
      }),
      execute: async () => "ok",
    });

    expect(warn).not.toHaveBeenCalled();
  });

  it("stays quiet under a test runner and in production", () => {
    vi.stubEnv("VITEST", "true");
    define("under_test");
    vi.stubEnv("VITEST", "");
    vi.stubEnv("NODE_ENV", "production");
    define("in_production");

    expect(warn).not.toHaveBeenCalled();
  });

  it("can be switched off per tool and for the app", () => {
    define("quiet_tool", { lint: false });
    expect(warn).not.toHaveBeenCalled();

    setAIConfig({ toolLint: false });
    define("quiet_app");
    expect(warn).not.toHaveBeenCalled();
  });

  it("applies targets from ai.config and lets a tool override them", () => {
    setAIConfig({ toolLint: { targets: ["anthropic"] } });
    define("anthropic_only");
    expect(warn).not.toHaveBeenCalled();

    define("override", { lint: { targets: ["openai-strict"] } });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("never changes the tool it returns", async () => {
    const built = define();

    expect(built.name).toBe("save_facts");
    await expect(built.invoke({ a: "x" })).resolves.toMatchObject({ data: "ok" });
  });
});
