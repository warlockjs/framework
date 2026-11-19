import { afterEach, describe, expect, it, vi } from "vitest";
import { MongoDbDriver } from "../../../../src/drivers/mongodb/mongodb-driver";

function driverWith(updateMany: ReturnType<typeof vi.fn>) {
  const driver = new MongoDbDriver({ database: "test", uri: "mongodb://localhost" });

  vi.spyOn(
    driver as unknown as { getDatabaseInstance(): unknown },
    "getDatabaseInstance",
  ).mockReturnValue({ collection: () => ({ updateMany }) });

  return driver;
}

const duplicateKey = () => Object.assign(new Error("E11000 duplicate key error"), { code: 11000 });
const updated = { matchedCount: 1, modifiedCount: 1, upsertedCount: 0, upsertedId: null };

describe("MongoDbDriver.atomic upsert race", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("retries an upsert that lost the race for a new key and updates the winner's document", async () => {
    const updateMany = vi.fn().mockRejectedValueOnce(duplicateKey()).mockResolvedValueOnce(updated);
    const driver = driverWith(updateMany);

    await driver.atomic("totals", { id: "k1" }, { $inc: { runs: 1 } }, { upsert: true });

    expect(updateMany).toHaveBeenCalledTimes(2);
  });

  it("gives up after three duplicate-key failures", async () => {
    const updateMany = vi.fn().mockRejectedValue(duplicateKey());
    const driver = driverWith(updateMany);

    await expect(
      driver.atomic("totals", { id: "k1" }, { $inc: { runs: 1 } }, { upsert: true }),
    ).rejects.toMatchObject({ code: 11000 });
    expect(updateMany).toHaveBeenCalledTimes(3);
  });

  it("does not retry a plain update or any other error", async () => {
    const plain = vi.fn().mockRejectedValue(duplicateKey());

    await expect(
      driverWith(plain).atomic("totals", { id: "k1" }, { $inc: { runs: 1 } }),
    ).rejects.toMatchObject({ code: 11000 });
    expect(plain).toHaveBeenCalledTimes(1);

    const other = vi.fn().mockRejectedValue(new Error("network"));

    await expect(
      driverWith(other).atomic("totals", { id: "k1" }, { $inc: { runs: 1 } }, { upsert: true }),
    ).rejects.toThrow("network");
    expect(other).toHaveBeenCalledTimes(1);
  });
});
