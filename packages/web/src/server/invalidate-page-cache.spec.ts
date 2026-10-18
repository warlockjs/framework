import { beforeEach, describe, expect, it, vi } from "vitest";

const { invalidate, tags, broadcastSocketEvent } = vi.hoisted(() => {
  const invalidate = vi.fn();
  return { invalidate, tags: vi.fn(() => ({ invalidate })), broadcastSocketEvent: vi.fn() };
});

vi.mock("@warlock.js/core", () => ({ broadcastSocketEvent }));
vi.mock("./page-cache-store-driver", () => ({
  resolvePageCacheStoreDriver: async () => ({ driver: { tags }, namespace: "warlock.page.demo" }),
}));

import { invalidatePageCache } from "./invalidate-page-cache";

beforeEach(() => {
  vi.clearAllMocks();
  invalidate.mockResolvedValue(undefined);
});

describe("page invalidation push", () => {
  it("broadcasts public dependency tags only after cache eviction completes", async () => {
    let release = () => {};
    invalidate.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const pending = invalidatePageCache(["products", "products"]);
    await Promise.resolve();
    expect(broadcastSocketEvent).not.toHaveBeenCalled();
    release();
    await pending;
    expect(tags).toHaveBeenCalledWith(["warlock.page.demo.products", "warlock.page.demo.products"]);
    expect(broadcastSocketEvent).toHaveBeenCalledWith("warlock:page-invalidated", {
      tags: ["products"],
    });
  });

  it("does not announce an eviction that failed", async () => {
    invalidate.mockRejectedValue(new Error("store unavailable"));
    await expect(invalidatePageCache(["products"])).rejects.toThrow("store unavailable");
    expect(broadcastSocketEvent).not.toHaveBeenCalled();
  });

  it("still evicts when no socket is available", async () => {
    broadcastSocketEvent.mockReturnValue(false);
    await expect(invalidatePageCache(["products"])).resolves.toBeUndefined();
    expect(invalidate).toHaveBeenCalledOnce();
  });
});
