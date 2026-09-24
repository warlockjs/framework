import { describe, expect, it, vi } from "vitest";
import { ScopedStorage } from "./scoped-storage";
import { Storage } from "./storage";
import type { StorageDriverContract, StorageFileData } from "./types";
import { StorageCapabilityError } from "./utils/storage-capability-error";

const data: StorageFileData = {
  path: "a/b.txt",
  url: "/a/b.txt",
  size: 1,
  hash: "h",
  mimeType: "text/plain",
  driver: "local",
};

function makeStorage(driver: Partial<StorageDriverContract>) {
  const storage = new Storage();
  (storage as unknown as { _driver: unknown })._driver = { name: "fake", ...driver };

  return storage;
}

describe("putIfAbsent() wrappers", () => {
  it("throws StorageCapabilityError when the driver has no putIfAbsent", async () => {
    const storage = makeStorage({});

    expect(storage.supportsPutIfAbsent()).toBe(false);
    await expect(storage.putIfAbsent("x", "a/b.txt")).rejects.toBeInstanceOf(
      StorageCapabilityError,
    );
    await expect(storage.putIfAbsent("x", "a/b.txt")).rejects.toThrow(/"fake"/);

    const scoped = new ScopedStorage({ name: "fake" } as unknown as StorageDriverContract);
    await expect(scoped.putIfAbsent("x", "a/b.txt")).rejects.toBeInstanceOf(
      StorageCapabilityError,
    );
  });

  it("emits the put events on success", async () => {
    const storage = makeStorage({ putIfAbsent: vi.fn().mockResolvedValue(data) });
    const before = vi.fn();
    const after = vi.fn();
    storage.on("beforePut", before);
    storage.on("afterPut", after);

    const file = await storage.putIfAbsent("x", "a/b.txt");

    expect(storage.supportsPutIfAbsent()).toBe(true);
    expect(file).not.toBeNull();
    expect(before).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("returns null and emits nothing when the driver returns null", async () => {
    const storage = makeStorage({ putIfAbsent: vi.fn().mockResolvedValue(null) });
    const before = vi.fn();
    const after = vi.fn();
    storage.on("beforePut", before);
    storage.on("afterPut", after);

    expect(await storage.putIfAbsent("x", "a/b.txt")).toBeNull();
    expect(before).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });
});
