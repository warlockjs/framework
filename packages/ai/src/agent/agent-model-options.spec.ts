import { describe, expect, it } from "vitest";
import { MockModel } from "../mock/mock-model";
import { tool } from "../tool/tool";
import { agent } from "./agent";

function model(): MockModel {
  return new MockModel("mock-model", [{ content: "ok", finishReason: "stop" }]);
}

describe("agent — per-call modelOptions", () => {
  it("shallow-merges execute modelOptions over the agent's for that run only", async () => {
    const mock = model();
    const runner = agent({
      model: mock,
      modelOptions: {
        temperature: 0.2,
        maxTokens: 1000,
        providerOptions: { anthropic: { betas: ["agent-beta"] } },
      },
    });

    await runner.execute("first", {
      modelOptions: {
        maxTokens: 64000,
        reasoning: { effort: "high" },
        providerOptions: { anthropic: { thinkingDisplay: "summarized" } },
      },
    });
    await runner.execute("second");

    const [first, second] = mock.callHistory;

    expect(first?.options).toMatchObject({
      temperature: 0.2,
      maxTokens: 64000,
      reasoning: { effort: "high" },
    });
    // Shallow: the per-call `providerOptions` replaces the agent's whole value.
    expect(first?.options?.providerOptions).toEqual({
      anthropic: { thinkingDisplay: "summarized" },
    });

    // The agent's own options are untouched by the earlier run.
    expect(second?.options).toMatchObject({
      temperature: 0.2,
      maxTokens: 1000,
      providerOptions: { anthropic: { betas: ["agent-beta"] } },
    });
    expect(second?.options?.reasoning).toBeUndefined();
  });

  it("keeps concurrent runs with different options apart", async () => {
    const mock = model();
    const runner = agent({ model: mock, modelOptions: { temperature: 0.5 } });

    await Promise.all([
      runner.execute("low", { modelOptions: { reasoning: { effort: "low" } } }),
      runner.execute("max", { modelOptions: { reasoning: { effort: "max" } } }),
    ]);

    const efforts = mock.callHistory.map((call) => call.options?.reasoning?.effort).sort();

    expect(efforts).toEqual(["low", "max"]);
    expect(mock.callHistory.every((call) => call.options?.temperature === 0.5)).toBe(true);
  });

  it("ignores tools, signal and responseSchema in per-call modelOptions", async () => {
    const mock = model();
    const foreignSignal = new AbortController().signal;

    const ping = tool({
      name: "ping",
      description: "Ping.",
      input: { "~standard": { version: 1, vendor: "test", validate: (value) => ({ value }) } },
      execute: async () => "pong",
    });

    await agent({ model: mock, tools: [ping] }).execute("hi", {
      modelOptions: {
        tools: [],
        signal: foreignSignal,
        responseSchema: { type: "object", properties: {} },
        temperature: 0.1,
      },
    });

    const options = mock.callHistory[0]?.options;

    expect(options?.temperature).toBe(0.1);
    expect(options?.signal).toBeUndefined();
    expect(options?.responseSchema).toBeUndefined();
    expect(options?.tools?.map((entry) => entry.name)).toEqual(["ping"]);
  });

  it("applies per-call modelOptions to stream()", async () => {
    const mock = model();
    const stream = agent({ model: mock, modelOptions: { maxTokens: 10 } }).stream("hi", {
      modelOptions: { maxTokens: 20, cacheControl: { breakpoints: 1, ttl: "1h" } },
    });

    await stream.result;

    expect(mock.callHistory[0]?.options).toMatchObject({
      maxTokens: 20,
      cacheControl: { breakpoints: 1, ttl: "1h" },
    });
  });
});
