import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryExtendedCacheDriver } from "./memory-extended-cache-driver";

describe("MemoryExtendedCacheDriver", () => {
  let driver: MemoryExtendedCacheDriver;

  beforeEach(() => {
    driver = new MemoryExtendedCacheDriver();
    driver.setOptions({});
    driver.setLoggingState(false);
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  it("has the memoryExtended name", () => {
    expect(driver.name).toBe("memoryExtended");
  });

  it("extends TTL each time the key is fetched", async () => {
    await driver.set("k", "v", 10);

    const entry = driver.data["k"];
    expect(entry.expiresAt).toBeTypeOf("number");
    const firstExpiresAt = entry.expiresAt as number;

    vi.spyOn(Date, "now").mockReturnValue(firstExpiresAt - 5000);

    await driver.get("k");

    expect(entry.expiresAt).toBeGreaterThan(firstExpiresAt - 5000);
    expect(entry.expiresAt).toBeGreaterThanOrEqual(firstExpiresAt);
    vi.restoreAllMocks();
  });

  it("does not resurrect an expired entry when reading", async () => {
    await driver.set("k", "v", 10);
    const entry = driver.data["k"];

    vi.spyOn(Date, "now").mockReturnValue(entry.expiresAt! + 1000);

    await expect(driver.get("k")).resolves.toBeNull();
    expect(driver.data["k"]).toBeUndefined();
    vi.restoreAllMocks();
  });

  it("does not slide the ttl on the onConflict existence check", async () => {
    await driver.set("k", "v", 10);
    const entry = driver.data["k"];
    const before = entry.expiresAt;

    vi.spyOn(Date, "now").mockReturnValue(before! - 5000);
    await driver.set("k", "other", { ttl: 10, onConflict: "create" });

    expect(entry.expiresAt).toBe(before);
    vi.restoreAllMocks();
  });

  it("returns null when the key is not present", async () => {
    await expect(driver.get("missing")).resolves.toBeNull();
  });

  it("falls back to default options.ttl when the stored entry has no ttl", async () => {
    driver.setOptions({ ttl: 60 });
    await driver.set("k", "v");
    await expect(driver.get("k")).resolves.toBe("v");
  });

  it("keeps a no-ttl entry non-expiring (expiresAt stays Infinity) across reads", async () => {
    // With no explicit/default ttl the driver default is Infinity, which
    // prepareDataForStorage records as expiresAt = Infinity. The sliding-window
    // read re-derives the same Infinity, so the entry never expires.
    await driver.set("k", { name: "Alice" });
    const entry = driver.data["k"];
    expect(entry.expiresAt).toBe(Infinity);

    await expect(driver.get("k")).resolves.toEqual({ name: "Alice" });
    expect(entry.expiresAt).toBe(Infinity);
  });

  it("deep-clones object values so cached state is not mutable through reads", async () => {
    const original = { nested: { count: 1 } };
    await driver.set("k", original);

    const fetched = (await driver.get("k")) as typeof original;
    expect(fetched).toEqual(original);
    expect(fetched).not.toBe(original);

    fetched.nested.count = 99;
    const second = (await driver.get("k")) as typeof original;
    expect(second.nested.count).toBe(1);
  });
});

describe("MemoryExtendedCacheDriver — extend", () => {
  let driver: MemoryExtendedCacheDriver;

  beforeEach(async () => {
    vi.useFakeTimers();
    driver = new MemoryExtendedCacheDriver();
    driver.setOptions({});
    driver.setLoggingState(false);
  });

  afterEach(async () => {
    await driver.disconnect();
    vi.useRealTimers();
  });

  // This driver slides the ttl on every live read, so each case reads only once,
  // at the end, instead of probing the entry in between.
  it("keeps the entry alive until ttl from the extend, not from the write", async () => {
    await driver.set("k", "v", 10);
    vi.advanceTimersByTime(6000);

    await expect(driver.extend("k", 10)).resolves.toBe(true);

    vi.advanceTimersByTime(9000); // 15s after the write: would be gone without extend
    await expect(driver.get("k")).resolves.toBe("v");
  });

  it("resets the expiry to ttl from now instead of adding to the time left", async () => {
    await driver.set("k", "v", 10);
    vi.advanceTimersByTime(6000);

    await expect(driver.extend("k", 10)).resolves.toBe(true);

    vi.advanceTimersByTime(11_000); // past the new deadline, so it is not 10 + 4
    await expect(driver.get("k")).resolves.toBeNull();
  });

  it("accepts duration strings", async () => {
    await driver.set("k", "v", 5);

    await expect(driver.extend("k", "1m")).resolves.toBe(true);

    vi.advanceTimersByTime(59_000);
    await expect(driver.get("k")).resolves.toBe("v");
  });

  it("expires after the extended duration string elapses", async () => {
    await driver.set("k", "v", 5);

    await expect(driver.extend("k", "1m")).resolves.toBe(true);

    vi.advanceTimersByTime(61_000);
    await expect(driver.get("k")).resolves.toBeNull();
  });

  it("returns false and creates nothing for a missing key", async () => {
    await expect(driver.extend("missing", 60)).resolves.toBe(false);
    await expect(driver.get("missing")).resolves.toBeNull();
  });

  it("returns false for an expired key", async () => {
    await driver.set("k", "v", 1);
    vi.advanceTimersByTime(2000);

    await expect(driver.extend("k", 60)).resolves.toBe(false);
    await expect(driver.get("k")).resolves.toBeNull();
  });

  it("removes the expiry when ttl is Infinity", async () => {
    await driver.set("k", "v", 5);

    await expect(driver.extend("k", Infinity)).resolves.toBe(true);

    vi.advanceTimersByTime(3_600_000);
    await expect(driver.get("k")).resolves.toBe("v");
  });

  it("keeps the stored value", async () => {
    await driver.set("k", { nested: [1, 2, 3] }, 5);
    await driver.extend("k", 60);

    await expect(driver.get("k")).resolves.toEqual({ nested: [1, 2, 3] });
  });

  it("rejects a negative ttl", async () => {
    await driver.set("k", "v", 5);

    await expect(driver.extend("k", -1)).rejects.toThrow();
  });

  it("slides later reads by the extended ttl, not the original one", async () => {
    await driver.set("k", "v", 100);
    await driver.extend("k", 10);

    vi.advanceTimersByTime(8000);
    await expect(driver.get("k")).resolves.toBe("v"); // read slides by 10s

    vi.advanceTimersByTime(11_000);
    await expect(driver.get("k")).resolves.toBeNull();
  });
});
