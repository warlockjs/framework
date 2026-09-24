import { databaseTransactionContext } from "@warlock.js/cascade";
import { afterEach, describe, expect, it } from "vitest";
import { CascadeAdapter } from "./cascade-adapter";

/**
 * Minimal model double: captures the handlers the adapter registers so the
 * spec can fire "created" the way cascade does (INSIDE the transaction).
 */
function fakeModel() {
  const handlers: Record<string, (model: unknown) => void> = {};
  const register = (name: string) => (handler: (model: unknown) => void) => {
    handlers[name] = handler;
    return () => undefined;
  };

  const model = {
    events: () => ({
      onCreated: register("created"),
      onUpdated: register("updated"),
      onDeleted: register("deleted"),
    }),
  };

  return { model, handlers };
}

describe("CascadeAdapter.registerEvents cache invalidation", () => {
  afterEach(() => {
    databaseTransactionContext.exit();
  });

  it("clears the cache again after COMMIT so a stale mid-transaction read does not survive", async () => {
    const cache = new Map<string, string>();
    const { model, handlers } = fakeModel();

    new CascadeAdapter(model as any).registerEvents(() => cache.clear());

    databaseTransactionContext.enter({ session: {} });

    // The transaction writes; the model event fires BEFORE commit.
    handlers.created({});
    expect(cache.size).toBe(0);

    // A concurrent reader misses the cache and caches the OLD committed row.
    cache.set("user:1", "old");

    // COMMIT: drivers take the queue, exit the context, then run it.
    const queued = databaseTransactionContext.takeAfterCommit();
    databaseTransactionContext.exit();

    for (const callback of queued) {
      await callback();
    }

    expect(cache.get("user:1")).toBeUndefined();
  });
});
