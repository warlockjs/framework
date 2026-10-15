import { describe, expect, it } from "vitest";
import { Storage } from "./storage";
import { StorageNotInitializedError } from "./utils/storage-not-initialized-error";

/**
 * A `Storage` instance whose `init()` was never called (e.g. the "storage"
 * connector was missing from a custom CLI command's `preload.connectors`)
 * left `_driver` as `null`. Every operation that reads `activeDriver` —
 * `put()` in particular reads `driver.name` before touching the driver —
 * then crashed with `TypeError: Cannot read properties of null (reading
 * 'name')` instead of a diagnosable error.
 */
describe("uninitialized Storage.put() (blog seeder dogfood)", () => {
  it("throws StorageNotInitializedError instead of a TypeError on driver.name", async () => {
    const storage = new Storage();

    await expect(storage.put(Buffer.from("x"), "posts/seed/x.jpg")).rejects.toBeInstanceOf(
      StorageNotInitializedError,
    );
  });
});
