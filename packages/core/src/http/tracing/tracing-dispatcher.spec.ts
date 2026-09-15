/**
 * Card 71622e4a — tracing hook dispatch.
 *
 * These specs exercise `resolveTracingConfig`/`dispatch*` directly, the same
 * way `log-request-lifecycle.ts` is tested elsewhere via injected ports: no
 * running Fastify server, exact call order and payload asserted on plain
 * spies.
 */
import config from "@mongez/config";
import { log } from "@warlock.js/logger";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTracingContext,
  dispatchPhase,
  dispatchRequestEnd,
  dispatchRequestStart,
  isTracingEnabled,
  resetTracingConfigForTests,
} from "./tracing-dispatcher";
import type { TracingContext, TracingHooks } from "./tracing.type";

const ctx: TracingContext = {
  traceId: "trace-1",
  requestId: "req-1",
  method: "GET",
  route: "/things/:id",
  path: "/things/42",
};

beforeEach(() => {
  resetTracingConfigForTests();
});

afterEach(() => {
  config.set("http.tracing", undefined);
  resetTracingConfigForTests();
  vi.restoreAllMocks();
});

describe("http.tracing — resolved once, disabled by default", () => {
  it("defaults to disabled when http.tracing is unset", () => {
    expect(isTracingEnabled()).toBe(false);
  });

  it("is disabled unless enabled is exactly true", () => {
    config.set("http.tracing", { enabled: false, hooks: [{}] });

    expect(isTracingEnabled()).toBe(false);
  });

  it("caches the resolved value — a config change after first read has no effect", () => {
    config.set("http.tracing", { enabled: false });

    expect(isTracingEnabled()).toBe(false);

    config.set("http.tracing", { enabled: true });

    expect(isTracingEnabled()).toBe(false);
  });
});

describe("disabled — zero overhead", () => {
  it("calls no hook at all", () => {
    const hook: TracingHooks = {
      onRequestStart: vi.fn(),
      onRequestEnd: vi.fn(),
      onPhase: vi.fn(),
    };

    config.set("http.tracing", { enabled: false, hooks: [hook] });

    dispatchRequestStart(ctx);
    dispatchPhase(ctx, { name: "handler", durationMs: 1 });
    dispatchRequestEnd(ctx, { status: 200, durationMs: 1 });

    expect(hook.onRequestStart).not.toHaveBeenCalled();
    expect(hook.onPhase).not.toHaveBeenCalled();
    expect(hook.onRequestEnd).not.toHaveBeenCalled();
  });

  it("never calls performance.now on the disabled dispatch path", () => {
    config.set("http.tracing", { enabled: false });

    const nowSpy = vi.spyOn(performance, "now");

    dispatchRequestStart(ctx);
    dispatchPhase(ctx, { name: "handler", durationMs: 1 });
    dispatchRequestEnd(ctx, { status: 200, durationMs: 1 });

    expect(nowSpy).not.toHaveBeenCalled();
  });
});

describe("enabled — dispatch order and payload", () => {
  it("calls every configured hook, in registration order, with the given ctx/payload", () => {
    const calls: string[] = [];
    const hookA: TracingHooks = { onPhase: () => calls.push("A") };
    const hookB: TracingHooks = { onPhase: () => calls.push("B") };

    config.set("http.tracing", { enabled: true, hooks: [hookA, hookB] });

    const phase = { name: "middleware", durationMs: 3, attrs: { name: "auth", index: 0 } };
    dispatchPhase(ctx, phase);

    expect(calls).toEqual(["A", "B"]);
  });

  it("passes the exact ctx built by buildTracingContext", () => {
    const onRequestStart = vi.fn();
    config.set("http.tracing", { enabled: true, hooks: [{ onRequestStart }] });

    const requestLike = {
      traceId: "t-9",
      id: "r-9",
      method: "POST",
      path: "/orders",
      route: { path: "/orders" },
    };

    dispatchRequestStart(buildTracingContext(requestLike));

    expect(onRequestStart).toHaveBeenCalledWith({
      traceId: "t-9",
      requestId: "r-9",
      method: "POST",
      route: "/orders",
      path: "/orders",
    });
  });
});

describe("a throwing hook never breaks dispatch, and is reported once per hook per process", () => {
  it("keeps calling the remaining hooks after one throws", () => {
    const calls: string[] = [];
    const throwing: TracingHooks = {
      onPhase: () => {
        throw new Error("boom");
      },
    };
    const survivor: TracingHooks = { onPhase: () => calls.push("survivor") };

    config.set("http.tracing", { enabled: true, hooks: [throwing, survivor] });

    expect(() => dispatchPhase(ctx, { name: "handler", durationMs: 1 })).not.toThrow();
    expect(calls).toEqual(["survivor"]);
  });

  it("reports the error once even across many dispatches of the same hook/verb", () => {
    const errorSpy = vi.spyOn(log, "error").mockImplementation(() => undefined as never);
    const throwing: TracingHooks = {
      onPhase: () => {
        throw new Error("boom");
      },
    };

    config.set("http.tracing", { enabled: true, hooks: [throwing] });

    dispatchPhase(ctx, { name: "handler", durationMs: 1 });
    dispatchPhase(ctx, { name: "handler", durationMs: 1 });
    dispatchPhase(ctx, { name: "handler", durationMs: 1 });

    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("reports onRequestStart/onPhase/onRequestEnd on the SAME hook as three separate verbs", () => {
    const errorSpy = vi.spyOn(log, "error").mockImplementation(() => undefined as never);
    const throwing: TracingHooks = {
      onRequestStart: () => {
        throw new Error("start boom");
      },
      onPhase: () => {
        throw new Error("phase boom");
      },
      onRequestEnd: () => {
        throw new Error("end boom");
      },
    };

    config.set("http.tracing", { enabled: true, hooks: [throwing] });

    dispatchRequestStart(ctx);
    dispatchPhase(ctx, { name: "handler", durationMs: 1 });
    dispatchRequestEnd(ctx, { status: 200, durationMs: 1 });

    expect(errorSpy).toHaveBeenCalledTimes(3);
  });
});
