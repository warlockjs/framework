import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import type { Trace } from "../contracts/trace.type";
import type { EvaluateConfig } from "../evaluate/evaluate.type";
import { createInMemoryTraceStore } from "../store/in-memory-trace-store";
import type { TraceStoreContract } from "../store/trace-store.contract";
import { makeSpan, makeTrace } from "../test-support/make-trace";
import { DEFAULT_TRACE_LIST_LIMIT } from "./parse-query";
import { createRequestHandler, type ServeConfig } from "./serve";

function fakeReq(url: string, method = "GET"): IncomingMessage {
  return {
    url,
    method,
    headers: { host: "127.0.0.1:4319" },
  } as unknown as IncomingMessage;
}

type Captured = { status: number; body: string };

function fakeRes(): ServerResponse & { captured: Captured } {
  const captured: Captured = { status: 0, body: "" };
  const res = {
    captured,
    headersSent: false,
    writeHead(status: number) {
      captured.status = status;
      res.headersSent = true;
      return res;
    },
    end(body?: string) {
      captured.body = body ?? "";
      return res;
    },
  };
  return res as unknown as ServerResponse & { captured: Captured };
}

const baseConfig: ServeConfig = {
  basePath: "/",
  title: "Panoptic",
  allowedHosts: ["127.0.0.1", "localhost"],
};

function get(store: TraceStoreContract, url: string, config = baseConfig): Captured {
  const res = fakeRes();

  createRequestHandler(store, config)(fakeReq(url), res);

  return res.captured;
}

/** A trace whose root carries captured content and one child span. */
function contentTrace(traceId: string, startedAt: string): Trace {
  const trace = makeTrace({
    traceId,
    startedAt,
    children: [makeSpan({ spanId: `${traceId}-tool`, traceId, input: { q: "secret" } })],
  });

  trace.root.input = "a long captured prompt";
  trace.root.output = "a long captured answer";
  trace.root.error = { type: "Boom", message: "it broke", stack: "at line 1" };

  return trace;
}

describe("dashboard serve — malformed ids", () => {
  it("answers 400 for a malformed percent escape in a trace id instead of throwing", () => {
    const store = createInMemoryTraceStore();
    let captured: Captured | undefined;

    expect(() => {
      captured = get(store, "/api/traces/%E0%A4%A");
    }).not.toThrow();
    expect(captured?.status).toBe(400);
    expect(JSON.parse(captured?.body ?? "{}")).toEqual({ error: "bad_trace_id" });
  });

  it("answers 400 for a malformed escape on the evaluate route instead of throwing", () => {
    const store = createInMemoryTraceStore();
    const config: ServeConfig = { ...baseConfig, evaluate: {} as EvaluateConfig };
    const res = fakeRes();

    expect(() =>
      createRequestHandler(store, config)(fakeReq("/api/traces/%E0/spans/x/evaluate", "POST"), res),
    ).not.toThrow();
    expect(res.captured.status).toBe(400);
  });

  it("answers 500 when the store throws instead of escaping the request listener", () => {
    const store = createInMemoryTraceStore();
    const broken: TraceStoreContract = {
      size: 0,
      add: (trace) => store.add(trace),
      clear: () => store.clear(),
      get: () => {
        throw new Error("store down");
      },
      query: () => store.query(),
      aggregate: () => store.aggregate(),
    };
    let captured: Captured | undefined;

    expect(() => {
      captured = get(broken, "/api/traces/t1");
    }).not.toThrow();
    expect(captured?.status).toBe(500);
    expect(JSON.parse(captured?.body ?? "{}")).toEqual({ error: "internal" });
  });
});

describe("dashboard serve — trace list", () => {
  it("returns summaries without span trees or captured content", () => {
    const store = createInMemoryTraceStore();
    store.add(contentTrace("t1", "2026-06-22T10:00:00.000Z"));

    const body = JSON.parse(get(store, "/api/traces").body) as Array<Record<string, unknown>>;
    const [summary] = body;
    const root = summary?.root as Record<string, unknown>;

    expect(body).toHaveLength(1);
    expect(summary?.traceId).toBe("t1");
    expect(summary?.spanCount).toBe(2);
    expect(typeof summary?.totalCost).toBe("number");
    expect(root.name).toBe("agent");
    expect(root.status).toBe("completed");
    expect(root).not.toHaveProperty("input");
    expect(root).not.toHaveProperty("output");
    expect(root).not.toHaveProperty("children");
    expect(root.error).toEqual({ type: "Boom", message: "it broke" });
    expect(get(store, "/api/traces").body).not.toContain("secret");
  });

  it("caps the list at the default limit, newest first", () => {
    const store = createInMemoryTraceStore();

    for (let index = 0; index < DEFAULT_TRACE_LIST_LIMIT + 50; index += 1) {
      const startedAt = new Date(Date.UTC(2026, 5, 22, 10, 0, index)).toISOString();
      store.add(makeTrace({ traceId: `t${index}`, startedAt }));
    }

    const body = JSON.parse(get(store, "/api/traces").body) as Array<{ traceId: string }>;

    expect(body).toHaveLength(DEFAULT_TRACE_LIST_LIMIT);
    expect(body[0]?.traceId).toBe(`t${DEFAULT_TRACE_LIST_LIMIT + 49}`);
  });

  it("honours ?limit= and returns full traces with ?full=1", () => {
    const store = createInMemoryTraceStore();
    store.add(contentTrace("t1", "2026-06-22T10:00:00.000Z"));
    store.add(contentTrace("t2", "2026-06-22T11:00:00.000Z"));

    const limited = JSON.parse(get(store, "/api/traces?limit=1").body) as Array<{
      traceId: string;
    }>;
    const full = JSON.parse(get(store, "/api/traces?full=1").body) as Trace[];

    expect(limited.map((trace) => trace.traceId)).toEqual(["t2"]);
    expect(full).toHaveLength(2);
    expect(full[0]?.root.input).toBe("a long captured prompt");
    expect(full[0]?.root.children).toHaveLength(1);
  });

  it("keeps the full trace on GET api/traces/:id", () => {
    const store = createInMemoryTraceStore();
    store.add(contentTrace("t1", "2026-06-22T10:00:00.000Z"));

    const trace = JSON.parse(get(store, "/api/traces/t1").body) as Trace;

    expect(trace.root.output).toBe("a long captured answer");
    expect(trace.root.children).toHaveLength(1);
  });
});
