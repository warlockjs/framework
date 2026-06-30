import config from "@mongez/config";
import { cache, MemoryCacheDriver } from "@warlock.js/cache";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getUseCase, useCase } from "../../../src/use-cases";
import type { UseCaseBroadcastChannel, UseCaseBroadcastEvent } from "../../../src/use-cases/types";

/**
 * Edge-case coverage for the use-case runtime: void handlers, best-effort
 * history persistence, the retries-performed count on the failure path, and
 * the frozen-input contract. Mirrors the in-memory cache + unique-name setup
 * of the sibling lifecycle tests so the registry can't collide across files.
 */
let nameCounter = 0;

function uniqueName(label: string): string {
  return `unit-uced-${label}-${nameCounter++}`;
}

beforeAll(async () => {
  const driver = new MemoryCacheDriver();

  driver.setOptions({});
  driver.setLoggingState(false);

  await cache.use(driver);
});

beforeEach(() => {
  config.set("use-cases", { benchmark: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useCase — void handler", () => {
  it("runs after middleware and broadcasts cleanly for a handler that returns undefined", async () => {
    let afterRan = false;
    const received: UseCaseBroadcastEvent[] = [];

    const channel: UseCaseBroadcastChannel = {
      broadcast(event) {
        received.push(event);
      },
    };

    config.set("use-cases", {
      benchmark: false,
      broadcast: { enabled: true, channels: [channel] },
    });

    const run = useCase<void, { tick: number }>({
      name: uniqueName("void-handler"),
      handler: async () => {
        // returns undefined
      },
      after: [
        async (output) => {
          // after must run for void handlers, and the output it sees is undefined
          afterRan = true;
          expect(output).toBeUndefined();
        },
      ],
      broadcast: true,
    });

    await expect(run({ tick: 1 })).resolves.toBeUndefined();

    expect(afterRan).toBe(true);
    // The broadcast payload is the (undefined) output as-is — no fabricated value.
    expect(received).toHaveLength(1);
    expect(received[0].payload).toBeUndefined();
  });

  it("fires onCompleted for a void handler", async () => {
    let snapshot: { output?: unknown } | undefined;

    const run = useCase<void, unknown>({
      name: uniqueName("void-completed"),
      handler: async () => {
        // returns undefined
      },
      onCompleted: (result) => {
        snapshot = result;
      },
    });

    await run({});

    expect(snapshot).toBeDefined();
    expect(snapshot?.output).toBeUndefined();
  });
});

describe("useCase — history is best-effort", () => {
  it("still resolves and fires onCompleted when cache.set rejects", async () => {
    let completed = false;

    // Force the very first history write (cache.set) to reject.
    const setSpy = vi.spyOn(cache, "set").mockRejectedValueOnce(new Error("cache down"));

    const run = useCase<{ ok: boolean }, unknown>({
      name: uniqueName("history-best-effort"),
      handler: async () => ({ ok: true }),
      onCompleted: () => {
        completed = true;
      },
    });

    await expect(run({})).resolves.toEqual({ ok: true });

    expect(setSpy).toHaveBeenCalled();
    expect(completed).toBe(true);
  });
});

describe("useCase — retries performed (failure path)", () => {
  it("reports retries performed, not total attempts, when all attempts fail", async () => {
    let attempts = 0;
    let snapshot: { retries?: { attempts: number; currentRetry: number } } | undefined;

    const run = useCase({
      name: uniqueName("retry-fail-count"),
      retry: { attempts: 3 },
      handler: async () => {
        attempts++;

        throw new Error("always fails");
      },
      onError: (result) => {
        snapshot = result;
      },
    });

    await expect(run({})).rejects.toThrow("always fails");

    expect(attempts).toBe(3);
    // 3 attempts = initial try + 2 retries performed (NOT 3).
    expect(snapshot?.retries?.attempts).toBe(3);
    expect(snapshot?.retries?.currentRetry).toBe(2);
  });

  it("reports zero retries when the first try succeeds", async () => {
    let snapshot: { retries?: { currentRetry: number } } | undefined;

    const run = useCase<{ ok: boolean }, unknown>({
      name: uniqueName("retry-zero"),
      retry: { attempts: 3 },
      handler: async () => ({ ok: true }),
      onCompleted: (result) => {
        snapshot = result;
      },
    });

    await run({});

    expect(snapshot?.retries?.currentRetry).toBe(0);
  });
});

describe("useCase — frozen-input contract", () => {
  it("does not freeze the reference that reaches the handler", async () => {
    let handlerThrew = false;

    const run = useCase<{ value: number }, { value: number }>({
      name: uniqueName("frozen-leak"),
      guards: [
        async () => {
          // guard only reads — establishes that a guard ran before the handler
        },
      ],
      handler: async (data) => {
        try {
          // A handler mutating its own input must NOT throw — the frozen clone
          // handed to guards must never leak to the handler.
          (data as { value: number }).value = 99;
        } catch {
          handlerThrew = true;
        }

        return data;
      },
    });

    const result = await run({ value: 1 });

    expect(handlerThrew).toBe(false);
    expect(result.value).toBe(99);
  });

  it("still hands guards a frozen view that rejects mutation", async () => {
    let mutationThrew = false;

    const run = useCase<{ ok: boolean }, { value: number }>({
      name: uniqueName("frozen-guard"),
      guards: [
        async (data) => {
          try {
            (data as { value: number }).value = 42;
          } catch {
            mutationThrew = true;
          }
        },
      ],
      handler: async () => ({ ok: true }),
    });

    await run({ value: 1 });

    expect(mutationThrew).toBe(true);
  });
});
