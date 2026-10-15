import config from "@mongez/config";
import { cache } from "@warlock.js/cache";
import { MemoryCacheDriver } from "@warlock.js/cache";
import { v } from "@warlock.js/seal";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getUseCase, useCase } from "../../../src/use-cases";
import { globalUseCasesEvents } from "../../../src/use-cases/use-case-events";

/**
 * These tests exercise the real `useCase()` runtime without the framework
 * bootstrap. We point the cache at an in-memory driver so the history +
 * cleanup paths work, and we disable benchmarking by default so latency
 * thresholds never make assertions flaky. Each use case uses a unique name
 * so the process-wide registry can't collide across tests.
 */
let nameCounter = 0;

function uniqueName(label: string): string {
  return `unit-uc-${label}-${nameCounter++}`;
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

describe("useCase — execution + registration", () => {
  it("runs the handler and returns its output", async () => {
    const run = useCase<{ value: number }, { input: number }>({
      name: uniqueName("basic"),
      handler: async (data) => ({ value: data.input * 2 }),
    });

    await expect(run({ input: 21 })).resolves.toEqual({ value: 42 });
  });

  it("registers the use case so it is retrievable by name", async () => {
    const name = uniqueName("register");

    useCase({
      name,
      handler: async () => ({ ok: true }),
    });

    expect(getUseCase(name)?.name).toBe(name);
  });

  it("$cleanup unregisters the use case", async () => {
    const name = uniqueName("cleanup");

    const run = useCase({
      name,
      handler: async () => ({ ok: true }),
    });

    expect(getUseCase(name)).toBeDefined();

    run.$cleanup();

    expect(getUseCase(name)).toBeUndefined();
  });
});

describe("useCase — pipeline order", () => {
  it("runs guards → before → handler → after → onCompleted in order", async () => {
    const order: string[] = [];

    const run = useCase({
      name: uniqueName("order"),
      guards: [
        async () => {
          order.push("guard");
        },
      ],
      schema: v.object({ value: v.number() }),
      before: [
        async (data) => {
          order.push("before");

          return data;
        },
      ],
      handler: async () => {
        order.push("handler");

        return { ok: true };
      },
      after: [
        async () => {
          order.push("after");
        },
      ],
      onCompleted: () => {
        order.push("onCompleted");
      },
    });

    await run({ value: 1 });

    expect(order).toEqual(["guard", "before", "handler", "after", "onCompleted"]);
  });

  it("before middleware can transform the data the handler receives", async () => {
    const run = useCase<{ seen: unknown }, { email: string }>({
      name: uniqueName("transform"),
      before: [
        async (data) => ({ ...data, email: data.email.toLowerCase() }),
      ],
      handler: async (data) => ({ seen: data }),
    });

    const result = await run({ email: "USER@X.COM" });

    expect(result.seen).toEqual({ email: "user@x.com" });
  });
});

describe("useCase — guards", () => {
  it("a throwing guard aborts before the handler runs", async () => {
    let handlerRan = false;

    const run = useCase({
      name: uniqueName("guard-abort"),
      guards: [
        async () => {
          throw new Error("forbidden");
        },
      ],
      handler: async () => {
        handlerRan = true;

        return { ok: true };
      },
    });

    await expect(run({})).rejects.toThrow("forbidden");
    expect(handlerRan).toBe(false);
  });

  it("guards receive a frozen view of the input", async () => {
    let mutationThrew = false;

    const run = useCase<{ ok: boolean }, { value: number }>({
      name: uniqueName("guard-frozen"),
      guards: [
        async (data) => {
          try {
            (data as { value: number }).value = 99;
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

describe("useCase — retry", () => {
  it("runs the handler exactly once when no retry is configured", async () => {
    let attempts = 0;

    const run = useCase({
      name: uniqueName("retry-none"),
      handler: async () => {
        attempts++;

        throw new Error("always fails");
      },
    });

    await expect(run({})).rejects.toThrow("always fails");
    expect(attempts).toBe(1);
  });

  it("retries up to the configured number of attempts", async () => {
    let attempts = 0;

    const run = useCase({
      name: uniqueName("retry-count"),
      retry: { attempts: 3 },
      handler: async () => {
        attempts++;

        throw new Error("always fails");
      },
    });

    await expect(run({})).rejects.toThrow("always fails");
    expect(attempts).toBe(3);
  });

  it("stops retrying once the handler succeeds", async () => {
    let attempts = 0;

    const run = useCase<{ ok: boolean }, any>({
      name: uniqueName("retry-success"),
      retry: { attempts: 5 },
      handler: async () => {
        attempts++;

        if (attempts < 2) {
          throw new Error("fail once");
        }

        return { ok: true };
      },
    });

    await expect(run({})).resolves.toEqual({ ok: true });
    expect(attempts).toBe(2);
  });

  it("reports the actual retry count on the completion snapshot", async () => {
    let attempts = 0;
    let snapshot: { retries?: { attempts: number; currentRetry: number } } | undefined;

    const run = useCase({
      name: uniqueName("retry-snapshot"),
      retry: { attempts: 5 },
      handler: async () => {
        attempts++;

        if (attempts < 3) {
          throw new Error("fail");
        }

        return { ok: true };
      },
      onCompleted: (result) => {
        snapshot = result;
      },
    });

    await run({});

    expect(snapshot?.retries?.attempts).toBe(5);
    expect(snapshot?.retries?.currentRetry).toBe(2);
  });
});

describe("useCase — after middleware isolation", () => {
  it("a throwing after middleware does not fail the use case", async () => {
    const run = useCase<{ ok: boolean }, any>({
      name: uniqueName("after-throws"),
      handler: async () => ({ ok: true }),
      after: [
        async () => {
          throw new Error("after failed");
        },
      ],
    });

    await expect(run({})).resolves.toEqual({ ok: true });
  });

  it("does not run after middleware when the handler throws", async () => {
    let afterRan = false;

    const run = useCase({
      name: uniqueName("after-skipped"),
      handler: async () => {
        throw new Error("boom");
      },
      after: [
        async () => {
          afterRan = true;
        },
      ],
    });

    await expect(run({})).rejects.toThrow("boom");
    expect(afterRan).toBe(false);
  });
});

describe("useCase — error lifecycle", () => {
  it("fires onError with the thrown error and rethrows", async () => {
    let captured: { error: Error; name: string } | undefined;

    const run = useCase({
      name: uniqueName("on-error"),
      handler: async () => {
        throw new Error("handler error");
      },
      onError: (ctx) => {
        captured = ctx;
      },
    });

    await expect(run({})).rejects.toThrow("handler error");
    expect(captured?.error.message).toBe("handler error");
  });

  it("increments the failed call counter on error", async () => {
    const name = uniqueName("fail-counter");

    const run = useCase({
      name,
      handler: async () => {
        throw new Error("nope");
      },
    });

    await expect(run({})).rejects.toThrow();
    await expect(run({})).rejects.toThrow();

    expect((getUseCase(name) as { calls: { failed: number } }).calls.failed).toBe(2);
  });
});

describe("useCase — lifecycle observer ordering", () => {
  it("fires invocation → use-case → global onCompleted in that order", async () => {
    const order: string[] = [];

    const subscription = globalUseCasesEvents.onCompleted(() => {
      order.push("global");
    });

    const run = useCase({
      name: uniqueName("observer-order"),
      onCompleted: () => {
        order.push("useCase");
      },
      handler: async () => ({ ok: true }),
    });

    await run(
      {},
      {
        onCompleted: () => {
          order.push("invocation");
        },
      },
    );

    subscription.unsubscribe();

    expect(order).toEqual(["invocation", "useCase", "global"]);
  });
});

describe("useCase — runtime options", () => {
  it("uses an explicit invocation id in the snapshot", async () => {
    let snapshot: { id: string } | undefined;

    const run = useCase({
      name: uniqueName("runtime-id"),
      handler: async () => ({ ok: true }),
      onCompleted: (result) => {
        snapshot = result;
      },
    });

    await run({}, { id: "custom-execution-id" });

    expect(snapshot?.id).toBe("custom-execution-id");
  });

  it("threads a pre-populated context through the pipeline", async () => {
    const run = useCase<{ user: string }, any>({
      name: uniqueName("runtime-ctx"),
      handler: async (_data, ctx) => ({ user: ctx.currentUser }),
    });

    const result = await run({}, { ctx: { currentUser: "alice" } });

    expect(result.user).toBe("alice");
  });
});
