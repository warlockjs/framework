/**
 * Card 71622e4a — `logRequestLifecycle` is the single funnel for
 * `onRequestStart` / `onRequestEnd` (the "response.write" tracing phase),
 * on both the success and throw paths.
 */
import config from "@mongez/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTracingConfigForTests } from "../http/tracing/tracing-dispatcher";
import type { TracingHooks } from "../http/tracing/tracing.type";
import { logRequestLifecycle, type RequestLogPorts } from "./log-request-lifecycle";

function fakePorts(): RequestLogPorts & { entries: unknown[] } {
  const entries: unknown[] = [];
  let clock = 0;

  return {
    entries,
    info: (entry) => entries.push({ level: "info", ...entry }),
    warn: (entry) => entries.push({ level: "warn", ...entry }),
    error: (entry) => entries.push({ level: "error", ...entry }),
    now: () => (clock += 10),
  };
}

const fakeRequest = {
  traceId: "trace-1",
  id: "req-1",
  method: "GET",
  path: "/things/1",
  route: { path: "/things/:id" },
} as never;

beforeEach(() => {
  resetTracingConfigForTests();
});

afterEach(() => {
  config.set("http.tracing", undefined);
  resetTracingConfigForTests();
  vi.restoreAllMocks();
});

describe("disabled — no tracing dispatch, log lines unaffected", () => {
  it("never calls a hook", async () => {
    const hook: TracingHooks = { onRequestStart: vi.fn(), onRequestEnd: vi.fn() };
    config.set("http.tracing", { enabled: false, hooks: [hook] });

    await logRequestLifecycle(
      fakePorts(),
      { module: "route", action: "GET /things/:id", requestId: "req-1", statusCode: () => 200, request: fakeRequest },
      async () => "ok",
    );

    expect(hook.onRequestStart).not.toHaveBeenCalled();
    expect(hook.onRequestEnd).not.toHaveBeenCalled();
  });
});

describe("enabled — onRequestStart before the run, onRequestEnd after with status + duration", () => {
  it("calls onRequestStart then onRequestEnd, in that order, with status and duration", async () => {
    const calls: string[] = [];
    const hook: TracingHooks = {
      onRequestStart: () => calls.push("start"),
      onRequestEnd: (_ctx, result) => calls.push(`end:${result.status}:${result.durationMs}`),
    };
    config.set("http.tracing", { enabled: true, hooks: [hook] });

    await logRequestLifecycle(
      fakePorts(),
      { module: "route", action: "GET /things/:id", requestId: "req-1", statusCode: () => 200, request: fakeRequest },
      async () => "ok",
    );

    expect(calls).toEqual(["start", "end:200:10"]);
  });

  it("passes the request's traceId/requestId/route/path on the ctx", () => {
    return new Promise<void>((resolve) => {
      const hook: TracingHooks = {
        onRequestStart: (ctx) => {
          expect(ctx).toEqual({
            traceId: "trace-1",
            requestId: "req-1",
            method: "GET",
            route: "/things/:id",
            path: "/things/1",
          });
          resolve();
        },
      };
      config.set("http.tracing", { enabled: true, hooks: [hook] });

      void logRequestLifecycle(
        fakePorts(),
        {
          module: "route",
          action: "GET /things/:id",
          requestId: "req-1",
          statusCode: () => 200,
          request: fakeRequest,
        },
        async () => "ok",
      );
    });
  });
});

describe("error handler path — onRequestEnd receives the error and the status", () => {
  it("still receives status when the error was already handled (run resolves, status reflects it)", async () => {
    const results: unknown[] = [];
    const hook: TracingHooks = { onRequestEnd: (_ctx, result) => results.push(result) };
    config.set("http.tracing", { enabled: true, hooks: [hook] });

    await logRequestLifecycle(
      fakePorts(),
      { module: "route", action: "GET /x", requestId: "req-1", statusCode: () => 500, request: fakeRequest },
      async () => "handled",
    );

    expect(results).toEqual([{ status: 500, durationMs: 10, error: undefined }]);
  });

  it("carries the error object when the run itself throws (unhandled)", async () => {
    const results: unknown[] = [];
    const hook: TracingHooks = { onRequestEnd: (_ctx, result) => results.push(result) };
    config.set("http.tracing", { enabled: true, hooks: [hook] });

    const boom = new Error("boom");

    await expect(
      logRequestLifecycle(
        fakePorts(),
        {
          module: "route",
          action: "GET /x",
          requestId: "req-1",
          statusCode: () => undefined,
          request: fakeRequest,
        },
        async () => {
          throw boom;
        },
      ),
    ).rejects.toThrow(boom);

    expect(results).toEqual([{ status: undefined, durationMs: 10, error: boom }]);
  });
});
