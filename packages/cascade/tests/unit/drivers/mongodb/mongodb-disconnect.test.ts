import { describe, expect, it, vi } from "vitest";
import { MongoDbDriver } from "../../../../src/drivers/mongodb/mongodb-driver";

const driverWithClient = (client: object) => {
  const driver = new MongoDbDriver({ database: "t", uri: "mongodb://127.0.0.1:1/t" });
  (driver as any).client = client;
  (driver as any).connected = true;

  return driver;
};

describe("MongoDbDriver.disconnect", () => {
  it("closes the client and reports disconnected", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const driver = driverWithClient({ close });

    await driver.disconnect();

    expect(close).toHaveBeenCalledTimes(1);
    expect(driver.isConnected).toBe(false);
  });

  it("is a no-op when never connected", async () => {
    await expect(
      new MongoDbDriver({ database: "t", uri: "mongodb://127.0.0.1:1/t" }).disconnect(),
    ).resolves.toBeUndefined();
  });

  it("forces the close when the graceful one stalls", async () => {
    vi.useFakeTimers();

    const close = vi
      .fn()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValue(undefined);
    const driver = driverWithClient({ close });

    const done = driver.disconnect();
    await vi.advanceTimersByTimeAsync(11_000);
    await done;

    expect(close).toHaveBeenNthCalledWith(2, true);
    expect(driver.isConnected).toBe(false);

    vi.useRealTimers();
  });
});
