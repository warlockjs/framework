import { MemoryCacheDriver, MemoryExtendedCacheDriver } from "@warlock.js/cache";
import { afterEach, describe, expect, it } from "vitest";
import { setConfig } from "../../../../config/config-setter";
import type { DoctorBootContext } from "../check.types";
import { memoryCacheCheck } from "./memory-cache.check";

const bootContext = {} as DoctorBootContext;

async function run() {
  return await memoryCacheCheck.run(bootContext);
}

class OtherDriver {}

afterEach(() => {
  setConfig("cache", undefined as unknown as never);
});

describe("doctor memory-cache check", () => {
  it("is ok for a bounded memory store", async () => {
    setConfig("cache", {
      default: "memory",
      drivers: { memory: MemoryCacheDriver },
      options: { memory: { maxSize: 5000 } },
    } as never);

    const result = await run();

    expect(result?.status).toBe("ok");
    expect(result?.detail).toContain("5000");
  });

  it("is ok when maxSize is absent (the 10,000-entry default applies)", async () => {
    setConfig("cache", {
      default: "memory",
      drivers: { memory: MemoryCacheDriver },
      options: { memory: {} },
    } as never);

    const result = await run();

    expect(result?.status).toBe("ok");
    expect(result?.detail).toContain("10000");
  });

  it("warns on an unbounded memory store, naming the setting", async () => {
    setConfig("cache", {
      default: "memory",
      drivers: { memory: MemoryCacheDriver },
      options: { memory: { maxSize: Infinity } },
    } as never);

    const result = await run();

    expect(result?.status).toBe("warn");
    expect(result?.detail).toContain("cache.options.memory.maxSize");
  });

  it("recognises drivers built on the memory driver under any name", async () => {
    setConfig("cache", {
      default: "local",
      drivers: { local: MemoryExtendedCacheDriver },
      options: { local: { maxSize: 0 } },
    } as never);

    expect((await run())?.status).toBe("warn");
  });

  it("is silent when the default store is not a memory driver", async () => {
    setConfig("cache", {
      default: "redis",
      drivers: { redis: OtherDriver, memory: MemoryCacheDriver },
      options: { memory: { maxSize: Infinity } },
    } as never);

    expect(await run()).toBeUndefined();
  });

  it("is silent when there is no cache config", async () => {
    expect(await run()).toBeUndefined();
  });
});
