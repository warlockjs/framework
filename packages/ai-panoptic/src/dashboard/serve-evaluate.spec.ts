import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { MockModel } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import { createInMemoryTraceStore } from "../store/in-memory-trace-store";
import { makeTrace } from "../test-support/make-trace";
import { createRequestHandler, type ServeConfig } from "./serve";

/**
 * A POST request needs the `IncomingMessage` `data`/`end` stream surface
 * `readJsonBody` reads — `serve-security.spec.ts`'s plain object fake only
 * covers GET. The body is queued via `queueMicrotask` so it always fires
 * AFTER `handle()` has synchronously attached the stream listeners (the
 * handler kicks off `handleEvaluate` fire-and-forget and returns before any
 * awaited step runs).
 */
function fakePostReq(opts: {
  url: string;
  host?: string;
  auth?: string;
  body?: string;
}): IncomingMessage {
  const emitter = new EventEmitter();
  const req = Object.assign(emitter, {
    url: opts.url,
    method: "POST",
    headers: {
      host: opts.host ?? "127.0.0.1:4319",
      ...(opts.auth ? { authorization: opts.auth } : {}),
    },
    destroy() {},
  });

  queueMicrotask(() => {
    if (opts.body !== undefined) {
      emitter.emit("data", Buffer.from(opts.body));
    }
    emitter.emit("end");
  });

  return req as unknown as IncomingMessage;
}

function fakeGetReq(url: string): IncomingMessage {
  return {
    url,
    method: "GET",
    headers: { host: "127.0.0.1:4319" },
  } as unknown as IncomingMessage;
}

type Captured = { status: number; body: string };

function fakeRes(): ServerResponse & { captured: Captured } {
  const captured: Captured = { status: 0, body: "" };
  const res = {
    captured,
    writeHead(status: number) {
      captured.status = status;
      return res;
    },
    end(body?: string) {
      captured.body = body ?? "";
      return res;
    },
  };
  return res as unknown as ServerResponse & { captured: Captured };
}

/** Let the evaluate route's async chain (body read → judge call → response) settle. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const baseConfig: ServeConfig = {
  basePath: "/",
  title: "Panoptic",
  allowedHosts: ["127.0.0.1", "localhost"],
};

describe("dashboard serve — evaluate route", () => {
  it("405s a POST to the evaluate path when evaluate isn't configured", async () => {
    const handle = createRequestHandler(createInMemoryTraceStore(), baseConfig);
    const res = fakeRes();

    handle(fakePostReq({ url: "/api/traces/t1/spans/t1/evaluate" }), res);
    await flush();

    expect(res.captured.status).toBe(405);
  });

  // The button's label text lives unconditionally in the served JS source
  // (same as every other button in the page — e.g. Tree/Timeline); only ITS
  // RUNTIME behavior is gated, by the baked-in EVALUATE_ENABLED flag the
  // inlined script checks before rendering anything. That flag is the
  // correct thing for a structural (non-executing) test to assert on.
  it("bakes EVALUATE_ENABLED = false into the served page when evaluate isn't configured", () => {
    const handle = createRequestHandler(createInMemoryTraceStore(), baseConfig);
    const res = fakeRes();

    handle(fakeGetReq("/"), res);

    expect(res.captured.body).toContain("EVALUATE_ENABLED = false");
  });

  it("bakes EVALUATE_ENABLED = true into the served page when evaluate IS configured", () => {
    const model = new MockModel("judge", [{ content: JSON.stringify({ score: 1, passed: true }) }]);
    const config: ServeConfig = { ...baseConfig, evaluate: { model } };
    const handle = createRequestHandler(createInMemoryTraceStore(), config);
    const res = fakeRes();

    handle(fakeGetReq("/"), res);

    expect(res.captured.body).toContain("EVALUATE_ENABLED = true");
  });

  it("still enforces the Host allowlist and bearer token on the evaluate route", async () => {
    const model = new MockModel("judge", [{ content: JSON.stringify({ score: 1, passed: true }) }]);
    const config: ServeConfig = { ...baseConfig, authToken: "s3cr3t", evaluate: { model } };
    const handle = createRequestHandler(createInMemoryTraceStore(), config);

    const badHost = fakeRes();
    handle(
      fakePostReq({ url: "/api/traces/t1/spans/t1/evaluate", host: "evil.example.com" }),
      badHost,
    );
    await flush();
    expect(badHost.captured.status).toBe(403);

    const noAuth = fakeRes();
    handle(fakePostReq({ url: "/api/traces/t1/spans/t1/evaluate" }), noAuth);
    await flush();
    expect(noAuth.captured.status).toBe(401);
  });

  it("404s when the trace doesn't exist", async () => {
    const model = new MockModel("judge", [{ content: JSON.stringify({ score: 1, passed: true }) }]);
    const config: ServeConfig = { ...baseConfig, evaluate: { model } };
    const handle = createRequestHandler(createInMemoryTraceStore(), config);
    const res = fakeRes();

    handle(fakePostReq({ url: "/api/traces/missing/spans/missing/evaluate" }), res);
    await flush();

    expect(res.captured.status).toBe(404);
    expect(JSON.parse(res.captured.body)).toMatchObject({ error: "trace_not_found" });
  });

  it("404s when the span doesn't exist on an existing trace", async () => {
    const store = createInMemoryTraceStore();
    store.add(makeTrace({ traceId: "t1" }));

    const model = new MockModel("judge", [{ content: JSON.stringify({ score: 1, passed: true }) }]);
    const config: ServeConfig = { ...baseConfig, evaluate: { model } };
    const handle = createRequestHandler(store, config);
    const res = fakeRes();

    handle(fakePostReq({ url: "/api/traces/t1/spans/missing-span/evaluate" }), res);
    await flush();

    expect(res.captured.status).toBe(404);
    expect(JSON.parse(res.captured.body)).toMatchObject({ error: "span_not_found" });
  });

  it("422s when the span carried no system prompt", async () => {
    const store = createInMemoryTraceStore();
    const trace = makeTrace({ traceId: "t1" });
    trace.root.input = "just a bare user string";
    store.add(trace);

    const model = new MockModel("judge", [{ content: JSON.stringify({ score: 1, passed: true }) }]);
    const config: ServeConfig = { ...baseConfig, evaluate: { model } };
    const handle = createRequestHandler(store, config);
    const res = fakeRes();

    handle(fakePostReq({ url: "/api/traces/t1/spans/t1/evaluate" }), res);
    await flush();

    expect(res.captured.status).toBe(422);
  });

  it("grades the span's system prompt and returns the verdict on success", async () => {
    const store = createInMemoryTraceStore();
    const trace = makeTrace({ traceId: "t1" });
    trace.root.input = [
      { role: "system", content: "Be a helpful support agent." },
      { role: "user", content: "Hi" },
    ];
    store.add(trace);

    const model = new MockModel("judge", [
      { content: JSON.stringify({ score: 0.9, passed: true, reason: "clear and scoped" }) },
    ]);
    const config: ServeConfig = { ...baseConfig, evaluate: { model } };
    const handle = createRequestHandler(store, config);
    const res = fakeRes();

    handle(
      fakePostReq({
        url: "/api/traces/t1/spans/t1/evaluate",
        body: JSON.stringify({ instructions: "Must be polite." }),
      }),
      res,
    );
    await flush();

    expect(res.captured.status).toBe(200);
    expect(JSON.parse(res.captured.body)).toMatchObject({
      score: 0.9,
      issues: ["clear and scoped"],
    });

    // The per-run instructions override actually reached the judge.
    const sent = model.callHistory
      .flatMap((call) => call.messages)
      .map((message) => JSON.stringify(message.content))
      .join("\n");
    expect(sent).toContain("Must be polite.");
  });

  it("413s an oversized body instead of buffering it indefinitely", async () => {
    const store = createInMemoryTraceStore();
    const trace = makeTrace({ traceId: "t1" });
    trace.root.input = [{ role: "system", content: "x" }];
    store.add(trace);

    const model = new MockModel("judge", [{ content: JSON.stringify({ score: 1, passed: true }) }]);
    const config: ServeConfig = { ...baseConfig, evaluate: { model } };
    const handle = createRequestHandler(store, config);
    const res = fakeRes();

    const oversized = JSON.stringify({ instructions: "x".repeat(70 * 1024) });
    handle(fakePostReq({ url: "/api/traces/t1/spans/t1/evaluate", body: oversized }), res);
    await flush();

    expect(res.captured.status).toBe(413);
  });

  it("502s when model resolution throws (the one step judgePromptBody can't guard)", async () => {
    const store = createInMemoryTraceStore();
    const trace = makeTrace({ traceId: "t1" });
    trace.root.input = [{ role: "system", content: "x" }];
    store.add(trace);

    const config: ServeConfig = {
      ...baseConfig,
      evaluate: {
        model: () => {
          throw new Error("client construction failed");
        },
      },
    };
    const handle = createRequestHandler(store, config);
    const res = fakeRes();

    handle(fakePostReq({ url: "/api/traces/t1/spans/t1/evaluate" }), res);
    await flush();

    expect(res.captured.status).toBe(502);
    expect(JSON.parse(res.captured.body)).toMatchObject({ error: "evaluate_failed" });
  });
});
