import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Context } from "../src/base-context";
import { ContextManager } from "../src/context-manager";

type Store = { value: string };

class NamedContext extends Context<Store> {
  public buildStore(payload?: Record<string, unknown>): Store {
    return { value: (payload?.value as string) ?? "" };
  }
}

function contexts(count: number): NamedContext[] {
  return Array.from({ length: count }, () => new NamedContext());
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("several contexts together", () => {
  it("keeps each context's store while another context runs inside it", async () => {
    const [first, second] = contexts(2) as [NamedContext, NamedContext];
    const outer = { value: "first" };

    await first.run(outer, async () => {
      await second.run({ value: "second" }, async () => {
        await delay(1);

        expect(first.getStore()).toBe(outer);
        expect(second.get("value")).toBe("second");
      });

      expect(first.getStore()).toBe(outer);
      expect(second.hasContext()).toBe(false);
    });
  });

  it("shadows only the context that runs again, and restores it afterwards", async () => {
    const [first, second] = contexts(2) as [NamedContext, NamedContext];
    const secondStore = { value: "second" };

    await first.run({ value: "outer" }, async () => {
      await second.run(secondStore, async () => {
        await first.run({ value: "inner" }, async () => {
          await delay(1);

          expect(first.get("value")).toBe("inner");
          expect(second.getStore()).toBe(secondStore);
        });

        expect(first.get("value")).toBe("outer");
        expect(second.getStore()).toBe(secondStore);
      });
    });
  });

  it("enter() changes only its own context for the rest of the async function", async () => {
    const [first, second] = contexts(2) as [NamedContext, NamedContext];
    const secondStore = { value: "second" };

    await first.run({ value: "run" }, async () => {
      await second.run(secondStore, async () => {
        first.enter({ value: "entered" });

        await delay(1);

        expect(first.get("value")).toBe("entered");
        expect(second.getStore()).toBe(secondStore);
      });
    });
  });

  it("enter() inside a child task never reaches the parent or a sibling", async () => {
    const [first] = contexts(1) as [NamedContext];

    await first.run({ value: "parent" }, async () => {
      const sibling = (async () => {
        await delay(5);

        return first.get("value");
      })();

      await (async () => {
        await delay(1);
        first.enter({ value: "child" });
        await delay(1);

        expect(first.get("value")).toBe("child");
      })();

      expect(first.get("value")).toBe("parent");
      await expect(sibling).resolves.toBe("parent");
    });
  });

  it("update() mutates the very object handed to run(), seen by every task in the scope", async () => {
    const [first, second] = contexts(2) as [NamedContext, NamedContext];
    const store = { value: "before" };

    await first.run(store, async () => {
      await second.run({ value: "other" }, async () => {
        const reader = (async () => {
          await delay(5);

          return first.get("value");
        })();

        first.update({ value: "after" });

        await expect(reader).resolves.toBe("after");
      });
    });

    expect(store.value).toBe("after");
  });

  it("keeps concurrent scopes of several contexts isolated", async () => {
    const [first, second] = contexts(2) as [NamedContext, NamedContext];

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        first.run({ value: `a${index}` }, () =>
          second.run({ value: `b${index}` }, async () => {
            await delay(Math.random() * 5);

            return `${first.get("value")}-${second.get("value")}`;
          }),
        ),
      ),
    );

    expect(results).toEqual(Array.from({ length: 20 }, (_, index) => `a${index}-b${index}`));
  });

  it("reads nothing outside every scope", async () => {
    const [first, second] = contexts(2) as [NamedContext, NamedContext];

    await first.run({ value: "x" }, async () => second.run({ value: "y" }, async () => {}));

    expect(first.hasContext()).toBe(false);
    expect(second.getStore()).toBeUndefined();
  });
});

describe("ContextManager.runAll with other contexts", () => {
  it("hands each context the exact store object and seeds missing ones with {}", async () => {
    const manager = new ContextManager();
    const [request, storage, database] = contexts(3) as [NamedContext, NamedContext, NamedContext];
    const requestStore = { value: "request" };

    manager.register("request", request).register("storage", storage).register("db", database);

    await manager.runAll({ request: requestStore, storage: { value: "s3" } }, async () => {
      await delay(1);

      expect(request.getStore()).toBe(requestStore);
      expect(storage.get("value")).toBe("s3");
      expect(database.getStore()).toEqual({});
    });

    expect(request.hasContext()).toBe(false);
  });

  it("works next to a context that was never registered", async () => {
    const manager = new ContextManager();
    const [registered, standalone] = contexts(2) as [NamedContext, NamedContext];

    manager.register("registered", registered);

    await standalone.run({ value: "standalone" }, async () => {
      await manager.runAll({ registered: { value: "registered" } }, async () => {
        expect(standalone.get("value")).toBe("standalone");
        expect(registered.get("value")).toBe("registered");

        await standalone.run({ value: "inner" }, async () => {
          expect(standalone.get("value")).toBe("inner");
          expect(registered.get("value")).toBe("registered");
        });

        expect(standalone.get("value")).toBe("standalone");
      });
    });
  });

  it("lets a context run again inside runAll without touching the others", async () => {
    const manager = new ContextManager();
    const [request, transaction] = contexts(2) as [NamedContext, NamedContext];
    const requestStore = { value: "request" };

    manager.register("request", request).register("transaction", transaction);

    await manager.runAll({ request: requestStore }, async () => {
      await transaction.run({ value: "tx" }, async () => {
        expect(request.getStore()).toBe(requestStore);
        expect(transaction.get("value")).toBe("tx");
      });

      expect(transaction.getStore()).toEqual({});
    });
  });

  it("still runs a context that overrides run()", async () => {
    const manager = new ContextManager();
    const calls: string[] = [];

    class TracingContext extends NamedContext {
      public run<T>(store: Store, callback: () => Promise<T>): Promise<T> {
        calls.push(store.value);

        return super.run(store, callback);
      }
    }

    const tracing = new TracingContext();
    const [plain] = contexts(1) as [NamedContext];

    manager.register("plain", plain).register("tracing", tracing);

    await manager.runAll({ plain: { value: "p" }, tracing: { value: "t" } }, async () => {
      expect(plain.get("value")).toBe("p");
      expect(tracing.get("value")).toBe("t");
    });

    expect(calls).toEqual(["t"]);
  });

  it("enters every registered context with a single async-storage run", async () => {
    const manager = new ContextManager();
    const registered = contexts(4);

    registered.forEach((context, index) => manager.register(`c${index}`, context));

    const run = vi.spyOn(AsyncLocalStorage.prototype, "run");

    await manager.runAll(
      Object.fromEntries(registered.map((_, index) => [`c${index}`, { value: `v${index}` }])),
      async () => {
        expect(registered.map((context) => context.get("value"))).toEqual(["v0", "v1", "v2", "v3"]);
      },
    );

    expect(run).toHaveBeenCalledTimes(1);
  });
});
