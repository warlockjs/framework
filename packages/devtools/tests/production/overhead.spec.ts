import { describe, expect, it } from "vitest";
import type { DevtoolsCaptureHooks } from "../../src/production/capture/engine";
import { createEngine, queryEvent } from "./capture/helpers";

const REQUESTS = 50_000;
const RUNS = 3;

const EVENTS = Array.from({ length: 5 }, (_, index) =>
  queryEvent({
    sql: `SELECT * FROM table_${index} WHERE id = $1`,
    bindings: [index],
    durationMs: 2,
  }),
);
const LOG = {
  level: "info" as const,
  module: "app",
  action: "seen",
  message: "request handled",
  at: 1,
};

/** One simulated request: 3 phases, 5 queries and 1 log line, as the tracing, query and log sources deliver them. */
function drive(hooks: DevtoolsCaptureHooks, index: number) {
  const id = `req-${index}`;
  const request = { requestId: id, method: "GET", path: "/posts/42", route: "/posts/:id" };

  hooks.onRequestStart(request);
  hooks.onPhase(request, { name: "middleware", durationMs: 1, startedAt: 1 });
  hooks.onPhase(request, { name: "validation", durationMs: 1, startedAt: 2 });
  hooks.onPhase(request, { name: "handler", durationMs: 4, startedAt: 3 });

  for (const event of EVENTS) hooks.onQuery(id, event);

  hooks.onLog(id, LOG);
  hooks.onRequestEnd(request, { status: 200, durationMs: 9 });
}

const noop = () => {};
const baseline: DevtoolsCaptureHooks = {
  onRequestStart: noop,
  onPhase: noop,
  onRequestEnd: noop,
  onQuery: noop,
  onLog: noop,
  onCache: noop,
};

/** Best of several runs, in microseconds per request. */
function measure(hooks: DevtoolsCaptureHooks): number {
  let best = Infinity;

  for (let run = 0; run < RUNS; run++) {
    const started = performance.now();

    for (let index = 0; index < REQUESTS; index++) drive(hooks, index);

    best = Math.min(best, ((performance.now() - started) * 1000) / REQUESTS);
  }

  return best;
}

function engineAt(sampleRate: number) {
  return createEngine({
    production: { sampleRate },
    random: Math.random,
    now: () => performance.timeOrigin + performance.now(),
  }).engine;
}

describe("capture overhead", () => {
  it("adds almost nothing to an unsampled request and little at the default rate", () => {
    // Warm up the code paths.
    measure(baseline);
    measure(engineAt(0).hooks);

    const base = measure(baseline);
    const unsampled = measure(engineAt(0).hooks) - base;
    const blended = measure(engineAt(0.1).hooks) - base;
    const full = measure(engineAt(1).hooks) - base;

    console.info(
      [
        `capture overhead over ${REQUESTS} simulated requests (3 phases, 5 queries, 1 log), best of ${RUNS}:`,
        `  baseline (no-op hooks)        ${base.toFixed(2)} us/request`,
        `  unsampled (sampleRate 0)      +${unsampled.toFixed(2)} us/request`,
        `  default (sampleRate 0.1)      +${blended.toFixed(2)} us/request`,
        `  every request (sampleRate 1)  +${full.toFixed(2)} us/request`,
      ].join("\n"),
    );

    expect(unsampled).toBeLessThanOrEqual(3);
    expect(blended).toBeLessThanOrEqual(25);
  });
});
