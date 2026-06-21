import { describe, expect, it, vi } from "vitest";
import { makeSpan, makeTrace } from "../test-support/make-trace";
import type {
  LangfuseClientLike,
  LangfuseObservationBody,
  LangfuseObservationLike,
  LangfuseTraceBody,
} from "./langfuse-exporter.type";
import { langfuseExporter } from "./langfuse-exporter";

type RecordedObservation = {
  type: "span" | "generation";
  body: LangfuseObservationBody;
  children: RecordedObservation[];
  endCalls: number;
};

function makeObservation(
  type: "span" | "generation",
  body: LangfuseObservationBody,
  sink: RecordedObservation[],
): LangfuseObservationLike {
  const entry: RecordedObservation = { type, body, children: [], endCalls: 0 };
  sink.push(entry);

  return {
    span: (childBody) => makeObservation("span", childBody, entry.children),
    generation: (childBody) => makeObservation("generation", childBody, entry.children),
    end: () => {
      entry.endCalls += 1;

      return undefined;
    },
  };
}

function makeMockClient() {
  let traceBody: LangfuseTraceBody | undefined;
  const observations: RecordedObservation[] = [];
  const flushAsync = vi.fn().mockResolvedValue(undefined);
  const shutdownAsync = vi.fn().mockResolvedValue(undefined);

  const client: LangfuseClientLike = {
    trace(body) {
      traceBody = body;
      return {
        span: (childBody) => makeObservation("span", childBody, observations),
        generation: (childBody) => makeObservation("generation", childBody, observations),
      };
    },
    flushAsync,
    shutdownAsync,
  };

  return {
    client,
    flushAsync,
    shutdownAsync,
    getTraceBody: () => traceBody,
    observations,
  };
}

/** Depth-first flatten of the recorded observation tree (root + descendants). */
function flattenObservations(observations: RecordedObservation[]): RecordedObservation[] {
  return observations.flatMap((observation) => [
    observation,
    ...flattenObservations(observation.children),
  ]);
}

describe("langfuseExporter", () => {
  it("should advertise the langfuse name", () => {
    const { client } = makeMockClient();

    expect(langfuseExporter({ client }).name).toBe("langfuse");
  });

  it("should create a trace from the root span", async () => {
    const mock = makeMockClient();
    const exporter = langfuseExporter({ client: mock.client });

    await exporter.export(
      makeTrace(makeSpan({ traceId: "trace-1", name: "checkout", sessionId: "sess-1" })),
    );

    expect(mock.getTraceBody()?.id).toBe("trace-1");
    expect(mock.getTraceBody()?.name).toBe("checkout");
    expect(mock.getTraceBody()?.sessionId).toBe("sess-1");
  });

  it("should map token-producing children to generations and pure tools to spans", async () => {
    const mock = makeMockClient();
    const exporter = langfuseExporter({ client: mock.client });

    const root = makeSpan({
      name: "router",
      children: [
        makeSpan({ spanId: "gen", name: "llm-call", usage: { input: 5, output: 7, total: 12 } }),
        makeSpan({ spanId: "tool", name: "search", type: "tool", usage: { input: 0, output: 0, total: 0 } }),
      ],
    });

    await exporter.export(makeTrace(root));

    const all = flattenObservations(mock.observations);
    const generation = all.find((observation) => observation.body.name === "llm-call");
    const tool = all.find((observation) => observation.body.name === "search");
    expect(generation?.type).toBe("generation");
    expect(generation?.body.usage).toEqual({ input: 5, output: 7, total: 12, unit: "TOKENS" });
    expect(tool?.type).toBe("span");
    expect(tool?.body.usage).toBeUndefined();
  });

  it("should nest grandchildren under their parent observation", async () => {
    const mock = makeMockClient();
    const exporter = langfuseExporter({ client: mock.client });

    const root = makeSpan({
      name: "agent",
      children: [
        makeSpan({
          spanId: "mid",
          name: "sub-agent",
          children: [makeSpan({ spanId: "leaf", name: "leaf-tool", type: "tool" })],
        }),
      ],
    });

    await exporter.export(makeTrace(root));

    const mid = flattenObservations(mock.observations).find(
      (observation) => observation.body.name === "sub-agent",
    );
    expect(mid?.children.map((child) => child.body.name)).toEqual(["leaf-tool"]);
  });

  it("should mark failed spans as ERROR level with the error message", async () => {
    const mock = makeMockClient();
    const exporter = langfuseExporter({ client: mock.client });

    const root = makeSpan({
      name: "agent",
      children: [
        makeSpan({
          spanId: "bad",
          name: "broken-tool",
          type: "tool",
          status: "failed",
          error: { type: "ToolError", message: "boom" },
        }),
      ],
    });

    await exporter.export(makeTrace(root));

    const broken = flattenObservations(mock.observations).find(
      (observation) => observation.body.name === "broken-tool",
    );
    expect(broken?.body.level).toBe("ERROR");
    expect(broken?.body.statusMessage).toBe("boom");
  });

  it("should end every observation exactly once", async () => {
    const mock = makeMockClient();
    const exporter = langfuseExporter({ client: mock.client });

    const root = makeSpan({
      name: "agent",
      children: [
        makeSpan({
          spanId: "mid",
          name: "sub-agent",
          children: [makeSpan({ spanId: "leaf", name: "leaf-tool", type: "tool" })],
        }),
      ],
    });

    await exporter.export(makeTrace(root));

    const all = flattenObservations(mock.observations);
    expect(all).toHaveLength(3); // root agent + sub-agent + leaf-tool (root is now an observation too)
    for (const observation of all) {
      expect(observation.endCalls).toBe(1);
    }
  });

  it("should delegate flush and shutdown to the client", async () => {
    const mock = makeMockClient();
    const exporter = langfuseExporter({ client: mock.client });

    await exporter.export(makeTrace(makeSpan()));
    await exporter.flush?.();
    await exporter.shutdown?.();

    expect(mock.flushAsync).toHaveBeenCalledTimes(1);
    expect(mock.shutdownAsync).toHaveBeenCalledTimes(1);
  });

  it("should meter a generation on OWN tokens, not the subtree rollup", async () => {
    const mock = makeMockClient();
    const exporter = langfuseExporter({ client: mock.client });

    // agent-a rolls up 30/30 tokens, 10/10 of which came from its tool child.
    const root = makeSpan({
      name: "root",
      children: [
        makeSpan({
          spanId: "agent",
          name: "agent-a",
          usage: { input: 30, output: 30, total: 60 },
          children: [
            makeSpan({
              spanId: "tool",
              name: "tool-a",
              type: "tool",
              usage: { input: 10, output: 10, total: 20 },
            }),
          ],
        }),
      ],
    });

    await exporter.export(makeTrace(root));

    const agent = flattenObservations(mock.observations).find(
      (observation) => observation.body.name === "agent-a",
    );
    expect(agent?.type).toBe("generation");
    // own = rolled-up minus child: { 30-10, 30-10, 60-20 }
    expect(agent?.body.usage).toEqual({ input: 20, output: 20, total: 40, unit: "TOKENS" });
  });

  it("should emit a composite node whose tokens all came from children as a plain span", async () => {
    const mock = makeMockClient();
    const exporter = langfuseExporter({ client: mock.client });

    const root = makeSpan({
      name: "root",
      children: [
        makeSpan({
          spanId: "wf",
          name: "workflow",
          type: "workflow",
          usage: { input: 10, output: 10, total: 20 },
          children: [
            makeSpan({ spanId: "a", name: "agent", usage: { input: 10, output: 10, total: 20 } }),
          ],
        }),
      ],
    });

    await exporter.export(makeTrace(root));

    const workflow = flattenObservations(mock.observations).find(
      (observation) => observation.body.name === "workflow",
    );
    expect(workflow?.type).toBe("span"); // own = 20 - 20 = 0 → not a generation, no double count
    expect(workflow?.body.usage).toBeUndefined();
  });

  it("should map captured span input/output onto the observation body", async () => {
    const mock = makeMockClient();
    const exporter = langfuseExporter({ client: mock.client });

    const root = makeSpan({
      name: "root",
      children: [makeSpan({ spanId: "a", name: "agent", input: "prompt", output: "reply" })],
    });

    await exporter.export(makeTrace(root));

    const agent = flattenObservations(mock.observations).find(
      (observation) => observation.body.name === "agent",
    );
    expect(agent?.body.input).toBe("prompt");
    expect(agent?.body.output).toBe("reply");
  });

  it("should meter the root execution's own tokens as an observation", async () => {
    const mock = makeMockClient();
    const exporter = langfuseExporter({ client: mock.client });

    // Single-agent trace: the root IS the LLM agent, with no token-producing
    // children. Its own tokens must still be metered (not just trace metadata).
    await exporter.export(
      makeTrace(makeSpan({ name: "solo-agent", usage: { input: 8, output: 12, total: 20 } })),
    );

    const root = flattenObservations(mock.observations).find(
      (observation) => observation.body.name === "solo-agent",
    );
    expect(root?.type).toBe("generation");
    expect(root?.body.usage).toEqual({ input: 8, output: 12, total: 20, unit: "TOKENS" });
  });

  it("should omit rolled-up usage/cost from metadata (the usage block is authoritative)", async () => {
    const mock = makeMockClient();
    const exporter = langfuseExporter({ client: mock.client });

    await exporter.export(
      makeTrace(makeSpan({ name: "agent", usage: { input: 8, output: 12, total: 20 } })),
    );

    const root = flattenObservations(mock.observations).find(
      (observation) => observation.body.name === "agent",
    );
    expect(root?.body.metadata?.["gen_ai.usage.total_tokens"]).toBeUndefined();
    expect(root?.body.metadata?.["gen_ai.usage.input_tokens"]).toBeUndefined();
    expect(root?.body.metadata?.["warlock.cost.usd"]).toBeUndefined();
    expect(root?.body.metadata?.["warlock.report.type"]).toBe("agent"); // non-usage metadata stays
  });
});
