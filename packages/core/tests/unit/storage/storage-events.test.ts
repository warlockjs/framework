import baseConfig from "@mongez/config";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { storage } from "../../../src/storage";
import { storageConfigurations } from "../../../src/storage/config";

/**
 * Storage events are awaited by every mutating operation (`put`, `delete`, ...)
 * via the protected `emit()` in core/src/storage/storage.ts. That await only
 * means something if the underlying trigger is async-aware: `@mongez/events`
 * ships BOTH a synchronous `triggerAll` and an awaiting `triggerAllAsync`, and
 * awaiting the synchronous one silently turns async listeners into
 * fire-and-forget (and turns a rejecting listener into an unhandled rejection).
 *
 * These tests pin the contract the public `storage.on()` API advertises:
 * an async handler is finished before the operation that fired it resolves.
 */
let root: string;

const roots: string[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "warlock-storage-events-"));
  roots.push(root);

  storage.reset();
  baseConfig.set("storage", {
    default: "local",
    drivers: {
      local: storageConfigurations.local({ root, urlPrefix: "/uploads" }),
    },
  });
});

afterEach(() => {
  storage.off("afterPut");
  storage.off("beforePut");
  storage.reset();
  baseConfig.set("storage", undefined);
});

afterAll(() => {
  for (const dir of roots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Storage events — async listeners", () => {
  it("waits for an async afterPut listener before put() resolves", async () => {
    await storage.init();

    let handled = false;

    storage.on("afterPut", async () => {
      // A real macrotask, not a bare microtask: a dropped promise is
      // indistinguishable from an awaited one across a single tick.
      await new Promise(resolve => setTimeout(resolve, 10));
      handled = true;
    });

    await storage.put(Buffer.from("payload"), "events/after.txt");

    expect(handled).toBe(true);
  });

  it("waits for an async beforePut listener before the write happens", async () => {
    await storage.init();

    const order: string[] = [];

    storage.on("beforePut", async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      order.push("listener");
    });

    await storage.put(Buffer.from("payload"), "events/before.txt");
    order.push("put");

    expect(order).toEqual(["listener", "put"]);
  });

  it("propagates a rejecting async listener to the caller", async () => {
    await storage.init();

    storage.on("afterPut", async () => {
      throw new Error("listener exploded");
    });

    await expect(storage.put(Buffer.from("payload"), "events/throws.txt")).rejects.toThrow(
      "listener exploded",
    );
  });
});
