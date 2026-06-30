import { cache } from "@warlock.js/cache";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CacheConnector } from "../../../src/connectors/cache-connector";

/**
 * Test subclass that exposes the protected `active` flag so a shutdown test
 * can put the connector into a "started" state without a real cache config.
 */
class TestCacheConnector extends CacheConnector {
  public setActive(active: boolean): void {
    this.active = active;
  }
}

/** A cache-driver double exposing only the `disconnect()` the connector calls. */
const makeFakeDriver = () => ({
  disconnect: vi.fn(async () => {}),
});

describe("CacheConnector — shutdown disconnects loaded drivers", () => {
  const originalLoadedDrivers = cache.loadedDrivers;

  afterEach(() => {
    cache.loadedDrivers = originalLoadedDrivers;
    vi.restoreAllMocks();
  });

  it("disconnects every loaded cache driver on shutdown", async () => {
    const connector = new TestCacheConnector();
    const redis = makeFakeDriver();
    const memory = makeFakeDriver();

    cache.loadedDrivers = { redis, memory } as never;
    connector.setActive(true);

    await connector.shutdown();

    expect(redis.disconnect).toHaveBeenCalledTimes(1);
    expect(memory.disconnect).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when the connector was never activated", async () => {
    const connector = new TestCacheConnector();
    const redis = makeFakeDriver();

    cache.loadedDrivers = { redis } as never;
    connector.setActive(false);

    await connector.shutdown();

    expect(redis.disconnect).not.toHaveBeenCalled();
  });
});
