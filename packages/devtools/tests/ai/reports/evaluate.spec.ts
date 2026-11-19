import { describe, expect, it, vi } from "vitest";
import { createAiEvaluator } from "../../../src/ai/reports/evaluate";

const runs = [
  { runId: "r1", agent: "support", startedAt: "2026-03-10T10:00:00Z" },
  { runId: "r2", agent: "billing", startedAt: "2026-03-10T11:00:00Z" },
  { runId: "r3", agent: "nope", startedAt: "2026-03-10T12:00:00Z" },
];
const traces: Record<string, { systemPrompt?: { hash: string; text?: string } }> = {
  r1: { systemPrompt: { hash: "h1", text: "You are support." } },
  r2: { systemPrompt: { hash: "h1", text: "You are support." } },
  r3: { systemPrompt: { hash: "h2" } },
};
const agentTraces = {
  available: () => true,
  list: () => runs,
  get: (id: string) => traces[id],
  subscribe: () => () => {},
  dispose() {},
} as never;

function make(module: Record<string, unknown> | Error, warn = vi.fn()) {
  return {
    warn,
    evaluator: createAiEvaluator({
      agentTraces,
      warn,
      load: async () => {
        if (module instanceof Error) throw module;

        return module;
      },
    }),
  };
}

const configured = {
  getEvaluateConfig: () => ({
    model: { provider: "openai", name: "judge" },
    instructions: "Be nice.",
  }),
  evaluateSystemPrompt: vi.fn(async () => ({ score: 0.8, issues: ["vague"] })),
};

const codeOf = async (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (e: { code?: string }) => e.code,
  );

describe("createAiEvaluator", () => {
  it("lists distinct prompts that kept their text", async () => {
    const view = await make(configured).evaluator.view();

    expect(view).toMatchObject({
      configured: true,
      judge: "openai/judge",
      instructions: "Be nice.",
    });
    expect(view.prompts).toHaveLength(1);
    expect(view.prompts[0]).toMatchObject({
      hash: "h1",
      runId: "r2",
      agents: ["billing", "support"],
      length: 16,
    });
  });

  it("reports not configured when there is no judge", async () => {
    const view = await make({
      getEvaluateConfig: () => undefined,
      evaluateSystemPrompt: vi.fn(),
    }).evaluator.view();

    expect(view).toMatchObject({ configured: false, judge: null, instructions: "" });
  });

  it("grades a pasted prompt and a run", async () => {
    const { evaluator } = make(configured);
    const result = await evaluator.evaluate({ systemPrompt: "Hello", instructions: "x" });

    expect(result).toMatchObject({ score: 0.8, issues: ["vague"], judge: "openai/judge" });
    expect(configured.evaluateSystemPrompt).toHaveBeenCalledWith("Hello", expect.anything(), "x");
    await evaluator.evaluate({ runId: "r1" });
    expect(configured.evaluateSystemPrompt).toHaveBeenLastCalledWith(
      "You are support.",
      expect.anything(),
      undefined,
    );
  });

  it("input.invalid for both or neither, and for sizes", async () => {
    const { evaluator } = make(configured);

    expect(await codeOf(evaluator.evaluate({}))).toBe("input.invalid");
    expect(await codeOf(evaluator.evaluate({ runId: "r1", systemPrompt: "x" }))).toBe(
      "input.invalid",
    );
    expect(await codeOf(evaluator.evaluate({ systemPrompt: "x".repeat(100_001) }))).toBe(
      "input.invalid",
    );
    expect(
      await codeOf(evaluator.evaluate({ systemPrompt: "x", instructions: "y".repeat(4001) })),
    ).toBe("input.invalid");
  });

  it("ai.evaluate-unavailable without a judge or Panoptic", async () => {
    expect(
      await codeOf(
        make({
          getEvaluateConfig: () => undefined,
          evaluateSystemPrompt: vi.fn(),
        }).evaluator.evaluate({ systemPrompt: "x" }),
      ),
    ).toBe("ai.evaluate-unavailable");
    expect(await codeOf(make(new Error("missing")).evaluator.evaluate({ systemPrompt: "x" }))).toBe(
      "ai.evaluate-unavailable",
    );
  });

  it("ai.prompt-not-found when the run is gone or has no text", async () => {
    const { evaluator } = make(configured);

    expect(await codeOf(evaluator.evaluate({ runId: "r3" }))).toBe("ai.prompt-not-found");
    expect(await codeOf(evaluator.evaluate({ runId: "zzz" }))).toBe("ai.prompt-not-found");
  });

  it("ai.evaluate-failed logs with a reference", async () => {
    const warn = vi.fn();
    const { evaluator } = make(
      {
        ...configured,
        evaluateSystemPrompt: vi.fn(async () => {
          throw new Error("quota");
        }),
      },
      warn,
    );
    const error = await evaluator.evaluate({ systemPrompt: "x" }).catch((e) => e);

    expect(error.code).toBe("ai.evaluate-failed");
    expect(error.ref).toBeTruthy();
    expect(warn.mock.calls[0]?.[0]).toContain(error.ref);
    expect(warn.mock.calls[0]?.[0]).toContain("quota");
  });
});
