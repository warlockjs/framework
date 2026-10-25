import { afterEach, describe, expect, it, vi } from "vitest";
import {
  diffAgentTraces,
  formatAgentTrace,
} from "../../../../../ai/src/trace/agent-trace-diff";
import { aiCommandAction } from "./ai-command.action";
import { aiTraceAction, formatAgentRunRows } from "./ai-trace.action";

const api = { formatAgentTrace, diffAgentTraces };

function trace(runId: string, prompt = "hash-a", toolHash = "tool-a") {
  return {
    schemaVersion: 1,
    runId,
    agent: "coach",
    model: { name: "fake", provider: "mock" },
    startedAt: "2026-10-25T10:00:00.000Z",
    status: "completed",
    input: "swap squats",
    systemPrompt: { hash: prompt },
    toolSchemas: {},
    turns: [
      {
        index: 0,
        startedAt: "2026-10-25T10:00:00.000Z",
        durationMs: 12,
        input: "swap squats",
        finishReason: "stop",
        toolsHash: "t",
        toolsOffered: [{ name: "update_plan", schemaHash: toolHash, tokens: 40 }],
        toolCalls: [],
        usage: { input: 10, output: 5, total: 15 },
        contract: [],
      },
    ],
    usage: { input: 10, output: 5, total: 15 },
  };
}

const row = {
  runId: "run_1",
  agent: "coach",
  status: "completed",
  startedAt: "2026-10-25T10:00:00.000Z",
  durationMs: 12,
  turns: 2,
  toolCalls: 1,
  refusals: 1,
  usage: { input: 10, output: 5 },
  cost: 0.00123,
};

function server(routes: Record<string, { status?: number; body?: unknown }>) {
  const urls: string[] = [];
  const fetcher = vi.fn(async (input: string) => {
    urls.push(input);
    const hit = routes[input.replace("http://localhost:2030/__warlock/api/ai/agent-runs", "") || "/"];
    if (!hit) throw new Error("connect ECONNREFUSED");
    return new Response(JSON.stringify(hit.body ?? null), { status: hit.status ?? 200 });
  });

  return { fetcher, urls };
}

const options = { url: "http://localhost:2030" };

afterEach(() => vi.restoreAllMocks());

describe("warlock ai trace", () => {
  it("lists recent runs as a table", async () => {
    const stdout = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { fetcher, urls } = server({ "/": { body: { available: true, runs: [row] } } });

    await aiTraceAction({ args: ["trace"], options }, { fetch: fetcher });

    expect(urls).toEqual(["http://localhost:2030/__warlock/api/ai/agent-runs"]);
    expect(String(stdout.mock.calls[0]?.[0])).toContain("run_1\tcoach\tcompleted\t2\t1\t1\t10/5\t0.001230");
  });

  it("prints a run with its turns", async () => {
    const stdout = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { fetcher } = server({ "/run_1": { body: trace("run_1") } });

    await aiTraceAction({ args: ["trace", "run_1"], options }, { fetch: fetcher, load: async () => api });

    const output = String(stdout.mock.calls[0]?.[0]);

    expect(output).toContain("coach  run_1  completed");
    expect(output).toContain("turn 0");
    expect(output).toContain("update_plan@");
  });

  it("prints the trace as JSON without loading @warlock.js/ai", async () => {
    const stdout = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { fetcher } = server({ "/run_1": { body: trace("run_1") } });
    const load = vi.fn(async () => api);

    await aiTraceAction({ args: ["trace", "run_1"], options: { ...options, json: true } }, { fetch: fetcher, load });

    expect(JSON.parse(String(stdout.mock.calls[0]?.[0]))).toMatchObject({ runId: "run_1" });
    expect(load).not.toHaveBeenCalled();
  });

  it("compares two runs: identical and changed", async () => {
    const stdout = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const same = server({ "/a": { body: trace("a") }, "/b": { body: trace("b") } });

    await aiTraceAction(
      { args: ["trace", "a"], options: { ...options, diff: "b" } },
      { fetch: same.fetcher, load: async () => api },
    );
    expect(String(stdout.mock.calls[0]?.[0])).toContain("sent the same system prompt and the same tool definitions");

    const changed = server({
      "/a": { body: trace("a") },
      "/b": { body: trace("b", "hash-b", "tool-b") },
    });

    await aiTraceAction(
      { args: ["trace", "a"], options: { ...options, diff: "b" } },
      { fetch: changed.fetcher, load: async () => api },
    );

    const output = String(stdout.mock.calls[1]?.[0]);

    expect(output).toContain("system prompt: changed");
    expect(output).toContain("tools changed: update_plan");
  });

  it("explains an unknown run id and an unreachable server", async () => {
    const { fetcher } = server({ "/missing": { status: 404 } });

    await expect(
      aiTraceAction({ args: ["trace", "missing"], options }, { fetch: fetcher }),
    ).rejects.toThrow('holds no agent trace for "missing"');
    await expect(
      aiTraceAction({ args: ["trace", "other"], options }, { fetch: fetcher }),
    ).rejects.toMatchObject({ code: "WL8008" });
  });

  it("explains devtools without the trace API and a server without AI traces", async () => {
    await expect(
      aiTraceAction(
        { args: ["trace", "run_1"], options },
        { fetch: server({ "/run_1": { status: 500 } }).fetcher },
      ),
    ).rejects.toMatchObject({ code: "WL8009" });
    await expect(
      aiTraceAction(
        { args: ["trace"], options },
        { fetch: server({ "/": { body: { available: false, message: "Install @warlock.js/ai." } } }).fetcher },
      ),
    ).rejects.toThrow("Install @warlock.js/ai.");
  });

  it("asks for @warlock.js/ai 5.38.0 or newer to format a run", async () => {
    const { fetcher } = server({ "/run_1": { body: trace("run_1") } });

    await expect(
      aiTraceAction({ args: ["trace", "run_1"], options }, { fetch: fetcher, load: async () => ({}) }),
    ).rejects.toThrow("5.38.0 or newer");
  });

  it("is reached through aiCommandAction, and unknown actions print the usage", async () => {
    const stdout = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { fetcher } = server({ "/": { body: { available: true, runs: [] } } });

    await aiCommandAction({ args: ["trace"], options }, { fetch: fetcher });
    expect(String(stdout.mock.calls[0]?.[0])).toBe("No agent runs recorded yet.");

    await expect(aiCommandAction({ args: ["nope"], options: {} })).rejects.toThrow("warlock ai trace");
  });
});

describe("formatAgentRunRows()", () => {
  it("prints a dash for an unpriced run", () => {
    expect(formatAgentRunRows([{ ...row, cost: undefined }])).toContain("10/5\t-");
  });
});
