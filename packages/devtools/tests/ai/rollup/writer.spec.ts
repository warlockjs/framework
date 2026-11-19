import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DevtoolsAiRollupIncrementError } from "../../../src/ai/rollup/increment-error";
import { createMemoryAiRollupStore } from "../../../src/ai/rollup/memory-store";
import { startAiRollupWriter } from "../../../src/ai/rollup/writer";
import type { DevtoolsAiRollupStore, ResolvedDevtoolsAiOptions } from "../../../src/ai/types";
import { agentSpan, HOUR, HOUR_START, priceOf, T0, traceOf, usage } from "./helpers";

const options: ResolvedDevtoolsAiOptions = {
  reports: true,
  retentionDays: 2,
  flushIntervalMs: 60_000,
  mode: "development",
};
const ALL = { fromHour: 0, toHour: Number.MAX_SAFE_INTEGER };

function trace(agent = "a", extra: Parameters<typeof agentSpan>[3] = {}) {
  return traceOf(agentSpan(agent, "m", "p", { usage: usage(10, 5), ...extra }));
}

describe("ai rollup writer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes pending deltas on the flush interval", async () => {
    const store = createMemoryAiRollupStore();
    const writer = startAiRollupWriter({ store, totalCost: priceOf, options });

    writer.record(trace());
    writer.record(trace());

    expect(await store.list(ALL)).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(60_000);

    const rows = await store.list(ALL);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ runs: 2, inputTokens: 20 });
    expect(writer.pending()).toEqual([]);
    await writer.stop();
  });

  it("returns copies from pending()", () => {
    const writer = startAiRollupWriter({
      store: createMemoryAiRollupStore(),
      totalCost: priceOf,
      options,
    });

    writer.record(trace());

    const [copy] = writer.pending();

    copy.runs = 99;

    expect(writer.pending()[0].runs).toBe(1);
  });

  it("never throws from record()", () => {
    const writer = startAiRollupWriter({
      store: createMemoryAiRollupStore(),
      totalCost: priceOf,
      options,
    });

    expect(() => writer.record(null as never)).not.toThrow();
    expect(writer.pending()).toEqual([]);
  });

  it("merges a failed write back and warns once a minute", async () => {
    const memory = createMemoryAiRollupStore();
    let failing = true;
    const store: DevtoolsAiRollupStore = {
      ...memory,
      async increment(deltas) {
        if (failing) throw new Error("db down");

        await memory.increment(deltas);
      },
    };
    const warn = vi.fn();
    const writer = startAiRollupWriter({ store, totalCost: priceOf, options, warn });

    writer.record(trace());
    await vi.advanceTimersByTimeAsync(60_000);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe(
      "Devtools could not save AI totals: db down. It will try again.",
    );
    expect(writer.pending()[0].runs).toBe(1);

    writer.record(trace());
    await vi.advanceTimersByTimeAsync(30_000); // second failing flush inside the minute: no new warning
    await writer.flush();

    expect(warn).toHaveBeenCalledTimes(1);

    failing = false;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(warn).toHaveBeenCalledTimes(1);
    expect((await memory.list(ALL))[0].runs).toBe(2);
    expect(writer.pending()).toEqual([]);
    await writer.stop();
  });

  it("retries only the deltas a partly failed write did not save", async () => {
    const memory = createMemoryAiRollupStore();
    let failOnce = true;
    const store: DevtoolsAiRollupStore = {
      ...memory,
      async increment(deltas) {
        if (!failOnce) return memory.increment(deltas);

        failOnce = false;

        // Saves the first delta, then fails on the rest, as a database error part-way would.
        await memory.increment(deltas.slice(0, 1));

        throw new DevtoolsAiRollupIncrementError(deltas.slice(1), {
          written: 1,
          cause: new Error("deadlock"),
        });
      },
    };
    const warn = vi.fn();
    const writer = startAiRollupWriter({ store, totalCost: priceOf, options, warn });

    writer.record(trace("a"));
    writer.record(trace("b"));
    writer.record(trace("c"));
    await writer.flush();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(writer.pending()).toHaveLength(2);

    await writer.flush();

    const rows = await memory.list(ALL);

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.runs)).toEqual([1, 1, 1]);
    expect(writer.pending()).toEqual([]);
    await writer.stop();
  });

  it("keeps the batch being written in pending() until the write settles", async () => {
    let release: () => void = () => undefined;
    const memory = createMemoryAiRollupStore();
    const store: DevtoolsAiRollupStore = {
      ...memory,
      async increment(deltas) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        await memory.increment(deltas);
      },
    };
    const writer = startAiRollupWriter({ store, totalCost: priceOf, options });

    writer.record(trace());
    const flushing = writer.flush();

    await vi.advanceTimersByTimeAsync(0);
    expect(writer.pending()).toHaveLength(1);

    release();
    await flushing;

    expect(writer.pending()).toEqual([]);
    expect((await memory.list(ALL))[0].runs).toBe(1);
    await writer.stop();
  });

  it("warns again after a minute", async () => {
    const store: DevtoolsAiRollupStore = {
      ...createMemoryAiRollupStore(),
      async increment() {
        throw new Error("down");
      },
    };
    const warn = vi.fn();
    const writer = startAiRollupWriter({ store, totalCost: priceOf, options, warn });

    writer.record(trace());
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(warn).toHaveBeenCalledTimes(2);
    await writer.stop();
  });

  it("serialises writes", async () => {
    let active = 0;
    let overlap = false;
    const store: DevtoolsAiRollupStore = {
      ...createMemoryAiRollupStore(),
      async increment() {
        active++;
        overlap ||= active > 1;
        await new Promise((resolve) => setTimeout(resolve, 100));
        active--;
      },
    };
    const writer = startAiRollupWriter({ store, totalCost: priceOf, options });

    writer.record(trace());
    const first = writer.flush();

    writer.record(trace("b"));
    const second = writer.flush();

    await vi.advanceTimersByTimeAsync(500);
    await Promise.all([first, second]);

    expect(overlap).toBe(false);
    await writer.stop();
  });

  it("prunes hours older than the retention every 10 minutes", async () => {
    const store = createMemoryAiRollupStore();
    const old = HOUR_START - 3 * 24 * HOUR;
    const recent = HOUR_START - HOUR;
    const iso = (at: number) => new Date(at + 1000).toISOString();

    await store.increment(
      [old, recent].map((hour) => {
        const [delta] = [trace("x", { endedAt: iso(hour) })].flatMap((item) =>
          // reuse the writer's own extraction through a throw-away writer
          (() => {
            const scratch = startAiRollupWriter({
              store: createMemoryAiRollupStore(),
              totalCost: priceOf,
              options,
            });

            scratch.record(item);

            return scratch.pending();
          })(),
        );

        return delta;
      }),
    );

    const writer = startAiRollupWriter({ store, totalCost: priceOf, options });

    await vi.advanceTimersByTimeAsync(9 * 60_000);
    expect(await store.list(ALL)).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(60_000);

    const rows = await store.list(ALL);

    expect(rows.map((row) => row.hour)).toEqual([recent]);
    await writer.stop();
  });

  it("folds new keys into (other) past maxKeys", () => {
    const writer = startAiRollupWriter({
      store: createMemoryAiRollupStore(),
      totalCost: priceOf,
      options,
      maxKeys: 2,
    });

    for (const name of ["a", "b", "c", "d"]) writer.record(trace(name));
    writer.record(trace("a"));

    const pending = writer.pending();
    const byAgent = Object.fromEntries(pending.map((delta) => [delta.agent, delta.runs]));

    expect(byAgent).toEqual({ a: 2, b: 1, "(other)": 2 });
  });

  it("stop() flushes what is pending and stops the timers", async () => {
    const store = createMemoryAiRollupStore();
    const writer = startAiRollupWriter({ store, totalCost: priceOf, options });

    writer.record(trace());
    await writer.stop();

    expect(await store.list(ALL)).toHaveLength(1);

    writer.record(trace());
    await vi.advanceTimersByTimeAsync(120_000);

    expect((await store.list(ALL))[0].runs).toBe(1);
  });

  it("stop() gives up after 5 seconds on a write that hangs", async () => {
    const store: DevtoolsAiRollupStore = {
      ...createMemoryAiRollupStore(),
      increment: () => new Promise<void>(() => undefined),
    };
    const writer = startAiRollupWriter({ store, totalCost: priceOf, options });

    writer.record(trace());

    let done = false;
    const stopping = writer.stop().then(() => {
      done = true;
    });

    await vi.advanceTimersByTimeAsync(4900);
    expect(done).toBe(false);

    await vi.advanceTimersByTimeAsync(200);
    await stopping;
    expect(done).toBe(true);
  });
});
