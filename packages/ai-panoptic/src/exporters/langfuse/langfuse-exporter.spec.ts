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

    const generation = mock.observations.find((observation) => observation.body.name === "llm-call");
    const tool = mock.observations.find((observation) => observation.body.name === "search");
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

    const mid = mock.observations.find((observation) => observation.body.name === "sub-agent");
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

    const broken = mock.observations.find((observation) => observation.body.name === "broken-tool");
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

    const flatten = (observations: RecordedObservation[]): RecordedObservation[] =>
      observations.flatMap((observation) => [observation, ...flatten(observation.children)]);

    const all = flatten(mock.observations);
    expect(all).toHaveLength(2); // sub-agent + leaf-tool (root is the trace)
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
});
