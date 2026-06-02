import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { Context } from "../src/base-context";

type UserStore = {
  userId: string;
  role: "admin" | "user";
};

class UserContext extends Context<UserStore> {
  public buildStore(payload?: Record<string, unknown>): UserStore {
    return {
      userId: (payload?.userId as string) ?? "",
      role: (payload?.role as UserStore["role"]) ?? "user",
    };
  }
}

function createContext(): UserContext {
  return new UserContext();
}

describe("Context.run", () => {
  it("exposes the store to the callback and its awaited descendants", async () => {
    const userContext = createContext();

    const result = await userContext.run({ userId: "u-1", role: "admin" }, async () => {
      await delay(1);

      return userContext.get("userId");
    });

    expect(result).toBe("u-1");
  });

  it("propagates the callback's resolved value back to the caller", async () => {
    const userContext = createContext();

    const result = await userContext.run({ userId: "u-1", role: "user" }, async () => {
      return { computed: 42 };
    });

    expect(result).toEqual({ computed: 42 });
  });

  it("returns a promise even though the callback returns a value synchronously", () => {
    const userContext = createContext();

    const returned = userContext.run({ userId: "u-1", role: "user" }, async () => "value");

    expect(returned).toBeInstanceOf(Promise);
  });

  it("releases the store once the callback resolves", async () => {
    const userContext = createContext();

    await userContext.run({ userId: "u-1", role: "admin" }, async () => {
      expect(userContext.hasContext()).toBe(true);
    });

    expect(userContext.hasContext()).toBe(false);
    expect(userContext.getStore()).toBeUndefined();
  });

  it("releases the store even when the callback throws", async () => {
    const userContext = createContext();

    await expect(
      userContext.run({ userId: "u-1", role: "admin" }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(userContext.hasContext()).toBe(false);
  });

  it("isolates two concurrent run() calls from each other", async () => {
    const userContext = createContext();

    const observed: Record<string, string | undefined> = {};

    await Promise.all([
      userContext.run({ userId: "alice", role: "admin" }, async () => {
        await delay(20);

        observed.alice = userContext.get("userId");
      }),
      userContext.run({ userId: "bob", role: "user" }, async () => {
        await delay(5);

        observed.bob = userContext.get("userId");
      }),
    ]);

    expect(observed.alice).toBe("alice");
    expect(observed.bob).toBe("bob");
  });

  it("keeps many concurrent run() calls isolated while each mutates its own store", async () => {
    const userContext = createContext();

    const ids = Array.from({ length: 25 }, (_, index) => `u-${index}`);

    const observed = await Promise.all(
      ids.map((id, index) =>
        userContext.run({ userId: id, role: "user" }, async () => {
          // Interleave the tasks so their async boundaries overlap.
          await delay(index % 5);
          userContext.set("role", "admin");
          await delay((ids.length - index) % 5);

          return { userId: userContext.get("userId"), role: userContext.get("role") };
        }),
      ),
    );

    expect(observed).toEqual(ids.map((id) => ({ userId: id, role: "admin" })));
  });

  it("does not let a child's mutation bleed into a concurrent sibling scope", async () => {
    const userContext = createContext();

    let bobRoleAfterAliceMutates: UserStore["role"] | undefined;

    await Promise.all([
      userContext.run({ userId: "alice", role: "user" }, async () => {
        await delay(2);
        userContext.set("role", "admin");
        await delay(10);
      }),
      userContext.run({ userId: "bob", role: "user" }, async () => {
        await delay(8);
        bobRoleAfterAliceMutates = userContext.get("role");
      }),
    ]);

    expect(bobRoleAfterAliceMutates).toBe("user");
  });
});

describe("Context.run nesting", () => {
  it("shadows the outer store inside an inner run and restores it afterward", async () => {
    const userContext = createContext();

    await userContext.run({ userId: "outer", role: "admin" }, async () => {
      expect(userContext.get("userId")).toBe("outer");

      await userContext.run({ userId: "inner", role: "user" }, async () => {
        expect(userContext.get("userId")).toBe("inner");
        expect(userContext.get("role")).toBe("user");
      });

      expect(userContext.get("userId")).toBe("outer");
      expect(userContext.get("role")).toBe("admin");
    });

    expect(userContext.hasContext()).toBe(false);
  });

  it("does not let an inner mutation touch the restored outer store", async () => {
    const userContext = createContext();

    await userContext.run({ userId: "outer", role: "admin" }, async () => {
      await userContext.run({ userId: "inner", role: "user" }, async () => {
        userContext.set("userId", "inner-mutated");

        expect(userContext.get("userId")).toBe("inner-mutated");
      });

      expect(userContext.get("userId")).toBe("outer");
    });
  });
});

describe("Context.get and getStore", () => {
  it("returns undefined when no context is active", () => {
    const userContext = createContext();

    expect(userContext.get("userId")).toBeUndefined();
    expect(userContext.getStore()).toBeUndefined();
  });

  it("returns the whole record from getStore inside a scope", async () => {
    const userContext = createContext();

    await userContext.run({ userId: "u-1", role: "admin" }, async () => {
      expect(userContext.getStore()).toEqual({ userId: "u-1", role: "admin" });
    });
  });
});

describe("Context.update", () => {
  it("merges a partial into the active store in place", async () => {
    const userContext = createContext();

    await userContext.run({ userId: "u-1", role: "user" }, async () => {
      userContext.update({ role: "admin" });

      expect(userContext.getStore()).toEqual({ userId: "u-1", role: "admin" });
    });
  });

  it("enters a fresh store from the partial when none is active", () => {
    const userContext = createContext();

    expect(userContext.hasContext()).toBe(false);

    userContext.update({ userId: "u-9" });

    expect(userContext.hasContext()).toBe(true);
    expect(userContext.get("userId")).toBe("u-9");
  });

  it("entering with an empty partial outside a scope still activates an empty context", () => {
    const userContext = createContext();

    userContext.update({});

    expect(userContext.hasContext()).toBe(true);
    expect(userContext.getStore()).toEqual({});
  });

  it("merges into the active store without dropping untouched keys", async () => {
    const userContext = createContext();

    await userContext.run({ userId: "u-1", role: "user" }, async () => {
      userContext.update({});

      expect(userContext.getStore()).toEqual({ userId: "u-1", role: "user" });
    });
  });
});

describe("Context.set", () => {
  it("is sugar for update of a single key", async () => {
    const userContext = createContext();

    await userContext.run({ userId: "u-1", role: "user" }, async () => {
      userContext.set("role", "admin");

      expect(userContext.get("role")).toBe("admin");
    });
  });

  it("mutates the active store in place rather than replacing the reference", async () => {
    const userContext = createContext();

    await userContext.run({ userId: "u-1", role: "user" }, async () => {
      const before = userContext.getStore();

      userContext.set("role", "admin");

      const after = userContext.getStore();

      expect(after).toBe(before);
      expect(after).toEqual({ userId: "u-1", role: "admin" });
    });
  });

  it("seeds a fresh context when set is called outside any scope", () => {
    const userContext = createContext();

    expect(userContext.hasContext()).toBe(false);

    userContext.set("userId", "late");

    expect(userContext.hasContext()).toBe(true);
    expect(userContext.get("userId")).toBe("late");
  });
});

describe("Context.enter", () => {
  it("sets a store without a callback so reads after it succeed", async () => {
    const userContext = createContext();

    await userContext.run({ userId: "", role: "user" }, async () => {
      userContext.enter({ userId: "entered", role: "admin" });

      expect(userContext.get("userId")).toBe("entered");
      expect(userContext.get("role")).toBe("admin");
    });
  });

  it("replaces the whole store rather than merging into the current one", async () => {
    const userContext = createContext();

    await userContext.run({ userId: "original", role: "admin" }, async () => {
      const before = userContext.getStore();

      userContext.enter({ userId: "replaced", role: "user" });

      const after = userContext.getStore();

      // enterWith swaps the reference, it does not Object.assign onto the old one.
      expect(after).not.toBe(before);
      expect(after).toEqual({ userId: "replaced", role: "user" });
    });
  });

  it("establishes a context on the main thread when none exists yet", () => {
    const userContext = createContext();

    expect(userContext.hasContext()).toBe(false);

    userContext.enter({ userId: "main", role: "user" });

    expect(userContext.hasContext()).toBe(true);
    expect(userContext.getStore()).toEqual({ userId: "main", role: "user" });
  });
});

describe("Context.clear", () => {
  it("empties the store but keeps the context active", async () => {
    const userContext = createContext();

    await userContext.run({ userId: "u-1", role: "admin" }, async () => {
      userContext.clear();

      expect(userContext.hasContext()).toBe(true);
      expect(userContext.get("userId")).toBeUndefined();
      expect(userContext.getStore()).toEqual({});
    });
  });

  it("activates an empty context when clear runs outside any scope", () => {
    const userContext = createContext();

    expect(userContext.hasContext()).toBe(false);

    userContext.clear();

    expect(userContext.hasContext()).toBe(true);
    expect(userContext.getStore()).toEqual({});
  });
});

describe("Context.hasContext", () => {
  it("distinguishes an empty value from the absence of a context", async () => {
    const userContext = createContext();

    expect(userContext.hasContext()).toBe(false);

    await userContext.run({ userId: "", role: "user" }, async () => {
      expect(userContext.hasContext()).toBe(true);
      expect(userContext.get("userId")).toBe("");
    });
  });
});

describe("Context.buildStore", () => {
  it("applies payload values and falls back to defaults", () => {
    const userContext = createContext();

    expect(userContext.buildStore({ userId: "u-1", role: "admin" })).toEqual({
      userId: "u-1",
      role: "admin",
    });

    expect(userContext.buildStore()).toEqual({ userId: "", role: "user" });
  });
});

describe("Context defaults outside any context", () => {
  it("reports no active context and undefined reads on a pristine instance", () => {
    const userContext = createContext();

    expect(userContext.hasContext()).toBe(false);
    expect(userContext.getStore()).toBeUndefined();
    expect(userContext.get("userId")).toBeUndefined();
    expect(userContext.get("role")).toBeUndefined();
  });

  it("two instances of the same context class keep separate stores", async () => {
    const first = createContext();
    const second = createContext();

    await first.run({ userId: "first", role: "admin" }, async () => {
      expect(first.get("userId")).toBe("first");
      // The sibling instance owns an independent AsyncLocalStorage.
      expect(second.hasContext()).toBe(false);
      expect(second.get("userId")).toBeUndefined();
    });
  });
});
