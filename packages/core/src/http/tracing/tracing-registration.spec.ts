/** Runtime tracing-hook registration and phase timing. */
import config from "@mongez/config";
import { log } from "@warlock.js/logger";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dispatchPhase,
  dispatchRequestEnd,
  dispatchRequestStart,
  isTracingEnabled,
  registerTracingHooks,
  resetTracingConfigForTests,
} from "./index";
import type { TracingContext, TracingHooks } from "./tracing.type";

const ctx: TracingContext = {
  traceId: "trace-1",
  requestId: "req-1",
  method: "GET",
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

describe("runtime tracing hook registration", () => {
  it("enables tracing while registered and disables it again when config is disabled", () => {
    const hook: TracingHooks = {
      onRequestStart: vi.fn(),
      onPhase: vi.fn(),
      onRequestEnd: vi.fn(),
    };

    config.set("http.tracing", { enabled: false });

    const unregister = registerTracingHooks(hook);

    expect(isTracingEnabled()).toBe(true);

    dispatchRequestStart(ctx);
    dispatchPhase(ctx, { name: "handler", durationMs: 1 });
    dispatchRequestEnd(ctx, { status: 200, durationMs: 1 });

    expect(hook.onRequestStart).toHaveBeenCalledWith(ctx);
    expect(hook.onPhase).toHaveBeenCalledOnce();
    expect(hook.onRequestEnd).toHaveBeenCalledWith(ctx, { status: 200, durationMs: 1 });

    unregister();

    expect(isTracingEnabled()).toBe(false);
  });

  it("dispatches configured hooks before runtime hooks", () => {
    const calls: string[] = [];
    config.set("http.tracing", {
      enabled: true,
      hooks: [{ onPhase: () => calls.push("config") }],
    });

    registerTracingHooks({ onPhase: () => calls.push("runtime") });
    dispatchPhase(ctx, { name: "handler", durationMs: 1 });

    expect(calls).toEqual(["config", "runtime"]);
  });

  it("isolates a throwing runtime hook", () => {
    const errorSpy = vi.spyOn(log, "error").mockImplementation(() => undefined as never);
    const survivor = vi.fn();

    registerTracingHooks({
      onPhase: () => {
        throw new Error("boom");
      },
    });
    registerTracingHooks({ onPhase: survivor });

    expect(() => dispatchPhase(ctx, { name: "handler", durationMs: 1 })).not.toThrow();
    expect(survivor).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledOnce();
  });
});

describe("phase start time", () => {
  it("fills startedAt from the current clock when omitted", () => {
    const onPhase = vi.fn();
    vi.spyOn(performance, "now").mockReturnValue(500);
    config.set("http.tracing", { enabled: true, hooks: [{ onPhase }] });

    dispatchPhase(ctx, { name: "handler", durationMs: 7 });

    expect(onPhase).toHaveBeenCalledWith(ctx, {
      name: "handler",
      durationMs: 7,
      startedAt: performance.timeOrigin + 493,
    });
  });

  it("preserves a caller-provided startedAt", () => {
    const onPhase = vi.fn();
    config.set("http.tracing", { enabled: true, hooks: [{ onPhase }] });
    const phase = { name: "handler", durationMs: 7, startedAt: 123.45 };

    dispatchPhase(ctx, phase);

    expect(onPhase).toHaveBeenCalledWith(ctx, phase);
  });
});
