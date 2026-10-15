import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { databaseTransactionContext } from "../../../src/context/database-transaction-context";
import { MongoDbDriver } from "../../../src/drivers/mongodb/mongodb-driver";
import { PostgresDriver } from "../../../src/drivers/postgres/postgres-driver";

/**
 * Flat-nesting semantics for `driver.transaction()`: a call made while a
 * transaction is already active JOINS it (runs the callback on the same
 * session) instead of opening a second, independent transaction. Without this,
 * an inner transaction on another connection can't see the outer's uncommitted
 * writes — the phantom-FK-violation bug a seeder hit when it created a row and
 * then called a service that opened its own transaction to reference it.
 *
 * The join path touches neither the pool nor a Mongo client, so it's unit
 * testable by seeding the async transaction context directly.
 */
type WithBegin = { beginTransaction(options?: unknown): Promise<unknown> };

describe("driver.transaction() — flat nesting", () => {
  beforeEach(() => databaseTransactionContext.clear());

  afterEach(() => {
    databaseTransactionContext.clear();
    vi.restoreAllMocks();
  });

  describe("PostgresDriver", () => {
    const makeDriver = () => new PostgresDriver({ database: "test" });

    it("opens a new transaction when none is active (begin + commit)", async () => {
      const driver = makeDriver();
      const commit = vi.fn().mockResolvedValue(undefined);
      const rollback = vi.fn().mockResolvedValue(undefined);
      const beginSpy = vi
        .spyOn(driver as unknown as WithBegin, "beginTransaction")
        .mockResolvedValue({ context: { id: "tx" }, commit, rollback });

      const result = await driver.transaction(async () => "ok");

      expect(result).toBe("ok");
      expect(beginSpy).toHaveBeenCalledTimes(1);
      expect(commit).toHaveBeenCalledTimes(1);
      expect(rollback).not.toHaveBeenCalled();
    });

    it("joins an already-active transaction instead of opening a nested one", async () => {
      const driver = makeDriver();
      const beginSpy = vi
        .spyOn(driver as unknown as WithBegin, "beginTransaction")
        .mockResolvedValue({ context: {}, commit: vi.fn(), rollback: vi.fn() });

      // Simulate being inside an outer transaction.
      databaseTransactionContext.setSession({ id: "outer" });

      let ran = false;
      const result = await driver.transaction(async () => {
        // Inner sees the SAME outer session — proof it joined, not a new tx.
        expect(databaseTransactionContext.getSession()).toEqual({ id: "outer" });
        ran = true;
        return "joined";
      });

      expect(ran).toBe(true);
      expect(result).toBe("joined");
      expect(beginSpy).not.toHaveBeenCalled();
      // The outer session is left intact for the outer transaction to commit.
      expect(databaseTransactionContext.getSession()).toEqual({ id: "outer" });
    });

    it("propagates an inner throw so the outer transaction unwinds", async () => {
      const driver = makeDriver();
      vi.spyOn(driver as unknown as WithBegin, "beginTransaction").mockResolvedValue({
        context: {},
        commit: vi.fn(),
        rollback: vi.fn(),
      });

      databaseTransactionContext.setSession({ id: "outer" });

      await expect(
        driver.transaction(async () => {
          throw new Error("inner failed");
        }),
      ).rejects.toThrow("inner failed");
    });
  });

  describe("MongoDBDriver", () => {
    const makeDriver = () => new MongoDbDriver({ database: "test", uri: "mongodb://localhost" });

    it("joins an already-active transaction rather than throwing", async () => {
      const driver = makeDriver();
      // Would blow up if the non-nested path ran (no replica set / client here).
      const ensureSpy = vi
        .spyOn(
          driver as unknown as { ensureReplicaSetAvailable(): Promise<void> },
          "ensureReplicaSetAvailable",
        )
        .mockResolvedValue(undefined);

      databaseTransactionContext.setSession({ id: "outer" });

      const result = await driver.transaction(async () => {
        expect(databaseTransactionContext.getSession()).toEqual({ id: "outer" });
        return "joined";
      });

      expect(result).toBe("joined");
      expect(ensureSpy).not.toHaveBeenCalled();
    });
  });
});
