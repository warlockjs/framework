import { afterEach, describe, expect, it } from "vitest";
import { Storage } from "./storage";
import { storageConfigurations } from "./config";
import { StorageNotInitializedError } from "./utils/storage-not-initialized-error";

/**
 * The test kit swaps every driver for a local one after the connectors start.
 * The configured default may be a cloud driver whose SDK is not installed, so
 * `init({ deferDefaultDriver: true })` must not build it.
 */
describe("Storage.init with a deferred default driver", () => {
  class TestStorage extends Storage {
    public builds: string[] = [];

    protected override resolveDriver(name: string) {
      this.builds.push(name);

      return super.resolveDriver(name);
    }
  }

  const instances: Storage[] = [];

  afterEach(() => {
    for (const instance of instances.splice(0)) instance.reset();
  });

  function create() {
    const storage = new TestStorage();

    instances.push(storage);
    storage.register("local", storageConfigurations.local({ root: "/tmp/warlock-deferred" }));

    return storage;
  }

  it("builds the default driver at init by default", async () => {
    const storage = create();

    await storage.init();

    expect(storage.builds).toContain("local");
  });

  it("builds nothing at init when deferred, then builds the default on first use", async () => {
    const storage = create();

    await storage.init({ deferDefaultDriver: true });

    expect(storage.builds).toEqual([]);
    expect(storage.activeDriver.name).toBe("local");
    expect(storage.builds).toEqual(["local"]);
  });

  it("still reports an uninitialized storage", () => {
    expect(() => new Storage().activeDriver).toThrow(StorageNotInitializedError);
  });
});
