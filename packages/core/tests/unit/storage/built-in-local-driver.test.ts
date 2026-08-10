import baseConfig from "@mongez/config";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { storage } from "../../../src/storage";
import { storageConfigurations } from "../../../src/storage/config";

describe("Storage built-in local driver", () => {
  beforeEach(() => {
    storage.reset();
    baseConfig.set("storage", undefined);
  });

  afterEach(() => {
    storage.reset();
    baseConfig.set("storage", undefined);
  });

  it("boots an app that ships no storage config at all", async () => {
    // The regression: the storage connector starts unconditionally, and
    // `init()` resolved the default driver NAME without anything registered
    // under it — so every app without `src/config/storage.ts` died at boot with
    // `Storage driver "local" is not configured`. Only scaffolded apps, which
    // always ship that file, hid it.
    await expect(storage.init()).resolves.toBeUndefined();
  });

  it("serves the local driver as the default when nothing is configured", async () => {
    await storage.init();

    expect(storage.activeDriver).toBeDefined();
    expect(storage.use("local")).toBeDefined();
  });

  it("lets an app's own local driver override the built-in one", async () => {
    // The built-in is registered BEFORE configured drivers precisely so a
    // project that defines its own `local` wins rather than fighting it.
    baseConfig.set("storage", {
      default: "local",
      drivers: {
        local: storageConfigurations.local({
          root: "/custom/root",
          urlPrefix: "/custom",
        }),
      },
    });

    await storage.init();

    expect(storage.use("local")).toBeDefined();
  });

  it("still fails loudly for a configured driver it cannot resolve", async () => {
    // The other half of the rule stays: naming a driver that does not exist is
    // an error worth surfacing, not something to paper over with a fallback.
    baseConfig.set("storage", { default: "nowhere", drivers: {} });

    await expect(storage.init()).rejects.toThrow(/not configured/);
  });
});
