import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { Context } from "../src/base-context";
import { ContextManager, contextManager } from "../src/context-manager";

type TraceStore = { traceId: string };
type UserStore = { userId: string };

class TraceContext extends Context<TraceStore> {
  public buildStore(payload?: Record<string, unknown>): TraceStore {
    return { traceId: (payload?.traceId as string) ?? "generated" };
  }
}

class UserContext extends Context<UserStore> {
  public buildStore(payload?: Record<string, unknown>): UserStore {
    return { userId: (payload?.userId as string) ?? "" };
  }
}

describe("ContextManager.register", () => {
  it("returns the manager so registrations chain", () => {
    const manager = new ContextManager();
    const traceContext = new TraceContext();
    const userContext = new UserContext();

    const returned = manager.register("trace", traceContext).register("user", userContext);

    expect(returned).toBe(manager);
    expect(manager.hasContext("trace")).toBe(true);
    expect(manager.hasContext("user")).toBe(true);
  });

  it("overwrites a registration that reuses a name", () => {
    const manager = new ContextManager();
    const first = new UserContext();
    const second = new UserContext();

    manager.register("user", first).register("user", second);

    expect(manager.getContext("user")).toBe(second);
  });
});

describe("ContextManager.buildStores", () => {
  it("calls each registered context's buildStore with the payload", () => {
    const manager = new ContextManager();
    manager.register("trace", new TraceContext()).register("user", new UserContext());

    const stores = manager.buildStores({ traceId: "t-1", userId: "u-1" });

    expect(stores).toEqual({
      trace: { traceId: "t-1" },
      user: { userId: "u-1" },
    });
  });

  it("substitutes an empty store when a context's buildStore returns nullish", () => {
    const manager = new ContextManager();

    class NullishContext extends Context<UserStore> {
      public buildStore(): UserStore {
        return undefined as unknown as UserStore;
      }
    }

    manager.register("user", new NullishContext());

    expect(manager.buildStores()).toEqual({ user: {} });
  });

  it("returns an empty record when no contexts are registered", () => {
    const manager = new ContextManager();

    expect(manager.buildStores({ traceId: "t-1" })).toEqual({});
  });
});

describe("ContextManager.runAll", () => {
  it("activates every registered context for the duration of the callback", async () => {
    const manager = new ContextManager();
    const traceContext = new TraceContext();
    const userContext = new UserContext();

    manager.register("trace", traceContext).register("user", userContext);

    const stores = manager.buildStores({ traceId: "t-1", userId: "u-1" });

    const seen = await manager.runAll(stores, async () => {
      return {
        traceId: traceContext.get("traceId"),
        userId: userContext.get("userId"),
      };
    });

    expect(seen).toEqual({ traceId: "t-1", userId: "u-1" });

    expect(traceContext.hasContext()).toBe(false);
    expect(userContext.hasContext()).toBe(false);
  });

  it("nests in registration order — first registered is the outermost layer", async () => {
    const manager = new ContextManager();
    const order: string[] = [];

    class OrderTrace extends Context<TraceStore> {
      public buildStore(): TraceStore {
        order.push("trace");

        return { traceId: "t" };
      }
    }

    class OrderUser extends Context<UserStore> {
      public buildStore(): UserStore {
        order.push("user");

        return { userId: "u" };
      }
    }

    const traceContext = new OrderTrace();
    const userContext = new OrderUser();

    manager.register("trace", traceContext).register("user", userContext);

    const stores = manager.buildStores();

    await manager.runAll(stores, async () => {
      expect(traceContext.get("traceId")).toBe("t");
      expect(userContext.get("userId")).toBe("u");
    });

    expect(order).toEqual(["trace", "user"]);
  });

  it("seeds an empty store for a context that has no matching key", async () => {
    const manager = new ContextManager();
    const userContext = new UserContext();

    manager.register("user", userContext);

    await manager.runAll({}, async () => {
      expect(userContext.hasContext()).toBe(true);
      expect(userContext.getStore()).toEqual({});
    });
  });

  it("propagates the callback's resolved value to the caller", async () => {
    const manager = new ContextManager();
    manager.register("user", new UserContext());

    const result = await manager.runAll({ user: { userId: "u-1" } }, async () => "result");

    expect(result).toBe("result");
  });

  it("invokes the callback directly when no contexts are registered", async () => {
    const manager = new ContextManager();

    const result = await manager.runAll({ ignored: { foo: 1 } }, async () => "bare");

    expect(result).toBe("bare");
  });

  it("keeps two concurrent runAll invocations isolated from each other", async () => {
    const manager = new ContextManager();
    const userContext = new UserContext();

    manager.register("user", userContext);

    const observed: Record<string, string | undefined> = {};

    await Promise.all([
      manager.runAll({ user: { userId: "left" } }, async () => {
        await delay(15);

        observed.left = userContext.get("userId");
      }),
      manager.runAll({ user: { userId: "right" } }, async () => {
        await delay(5);

        observed.right = userContext.get("userId");
      }),
    ]);

    expect(observed.left).toBe("left");
    expect(observed.right).toBe("right");

    expect(userContext.hasContext()).toBe(false);
  });
});

describe("ContextManager.enterAll", () => {
  it("only enters contexts whose name has a truthy store value", async () => {
    const manager = new ContextManager();
    const traceContext = new TraceContext();
    const userContext = new UserContext();

    manager.register("trace", traceContext).register("user", userContext);

    await traceContext.run({ traceId: "outer" }, async () => {
      manager.enterAll({ user: { userId: "u-1" } });

      expect(userContext.get("userId")).toBe("u-1");
      expect(traceContext.get("traceId")).toBe("outer");
    });
  });

  it("skips a context when its store value is falsy", async () => {
    const manager = new ContextManager();
    const userContext = new UserContext();

    manager.register("user", userContext);

    await userContext.run({ userId: "kept" }, async () => {
      manager.enterAll({ user: undefined });

      expect(userContext.get("userId")).toBe("kept");
    });
  });

  it("ignores store keys that do not match a registered context", async () => {
    const manager = new ContextManager();
    const userContext = new UserContext();

    manager.register("user", userContext);

    await userContext.run({ userId: "kept" }, async () => {
      manager.enterAll({ unknown: { whatever: true } });

      expect(userContext.get("userId")).toBe("kept");
    });
  });
});

describe("ContextManager.clearAll", () => {
  it("clears the store on every registered context", async () => {
    const manager = new ContextManager();
    const traceContext = new TraceContext();
    const userContext = new UserContext();

    manager.register("trace", traceContext).register("user", userContext);

    const stores = manager.buildStores({ traceId: "t-1", userId: "u-1" });

    await manager.runAll(stores, async () => {
      manager.clearAll();

      expect(traceContext.getStore()).toEqual({});
      expect(userContext.getStore()).toEqual({});
    });
  });

  it("is a no-op when there are no registered contexts", () => {
    const manager = new ContextManager();

    expect(() => manager.clearAll()).not.toThrow();
  });
});

describe("ContextManager.getContext", () => {
  it("returns the registered instance or undefined", () => {
    const manager = new ContextManager();
    const userContext = new UserContext();

    manager.register("user", userContext);

    expect(manager.getContext("user")).toBe(userContext);
    expect(manager.getContext("missing")).toBeUndefined();
  });
});

describe("ContextManager.unregister", () => {
  it("removes a registration and reports whether one existed", () => {
    const manager = new ContextManager();

    manager.register("user", new UserContext());

    expect(manager.unregister("user")).toBe(true);
    expect(manager.hasContext("user")).toBe(false);
    expect(manager.unregister("user")).toBe(false);
  });
});

describe("contextManager singleton", () => {
  it("is an instance of ContextManager", () => {
    expect(contextManager).toBeInstanceOf(ContextManager);
  });
});
