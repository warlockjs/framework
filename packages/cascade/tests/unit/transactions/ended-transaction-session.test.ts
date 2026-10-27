import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { databaseTransactionContext } from "../../../src/context/database-transaction-context";
import { MongoDbDriver } from "../../../src/drivers/mongodb/mongodb-driver";
import { PostgresDriver } from "../../../src/drivers/postgres/postgres-driver";
import { afterCommit } from "../../../src/transactions/after-commit";

/**
 * Work armed inside a transaction (timer, queue, fire-and-forget promise) keeps
 * the transaction's context store. Once the transaction ends, that store must
 * stop handing out the session, so the late work runs outside any transaction.
 *
 * Drivers are exercised with a faked client/pool (no live database): the fake
 * sessions only need to exist and be finished, the assertions are about what
 * the context hands out afterwards.
 */
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Seen = { session: unknown; active: boolean };

function probe(): { seen: Seen[]; run: () => void } {
  const seen: Seen[] = [];

  return {
    seen,
    run: () =>
      void seen.push({
        session: databaseTransactionContext.getSession(),
        active: databaseTransactionContext.hasActiveTransaction(),
      }),
  };
}

describe("ended transaction store", () => {
  beforeEach(() => databaseTransactionContext.clear());
  afterEach(() => {
    databaseTransactionContext.clear();
    vi.restoreAllMocks();
  });

  describe("context", () => {
    it("hands out the session until the store is ended", async () => {
      const store = { session: { id: 1 }, afterCommit: [] };

      await databaseTransactionContext.run(store, async () => {
        expect(databaseTransactionContext.getSession()).toBe(store.session);
        expect(databaseTransactionContext.hasActiveTransaction()).toBe(true);

        databaseTransactionContext.end(store);

        expect(databaseTransactionContext.getSession()).toBeUndefined();
        expect(databaseTransactionContext.hasActiveTransaction()).toBe(false);
      });
    });

    it("runs afterCommit() on a microtask when the store has ended", async () => {
      const store = { session: { id: 1 }, afterCommit: [] };
      const fn = vi.fn();

      await databaseTransactionContext.run(store, async () => {
        databaseTransactionContext.end(store);
        afterCommit(fn);
        expect(fn).not.toHaveBeenCalled();

        await Promise.resolve();
        await Promise.resolve();

        expect(fn).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("PostgresDriver", () => {
    const makeDriver = (client: object) => {
      const driver = new PostgresDriver({ database: "test" });
      const commit = vi.fn().mockResolvedValue(undefined);
      const rollback = vi.fn().mockResolvedValue(undefined);
      const begin = vi
        .spyOn(driver as unknown as { beginTransaction(): Promise<unknown> }, "beginTransaction")
        .mockResolvedValue({ context: client, commit, rollback });

      return { driver, begin };
    };

    it("a timer armed in transaction() runs without the session after commit", async () => {
      const client = { id: "pg" };
      const { driver } = makeDriver(client);
      const timer = probe();
      const inside = probe();

      await driver.transaction(async () => {
        setTimeout(timer.run, 5);
        inside.run();
      });
      await wait(20);

      expect(inside.seen[0]).toEqual({ session: client, active: true });
      expect(timer.seen).toEqual([{ session: undefined, active: false }]);
    });

    it("a timer armed in transaction() runs without the session after rollback", async () => {
      const { driver } = makeDriver({ id: "pg" });
      const timer = probe();

      await expect(
        driver.transaction(async () => {
          setTimeout(timer.run, 5);
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      await wait(20);

      expect(timer.seen).toEqual([{ session: undefined, active: false }]);
    });

    it("a transaction() started by late work opens a fresh transaction", async () => {
      const client = { id: "pg" };
      const { driver, begin } = makeDriver(client);
      const nested = probe();

      await driver.transaction(async () => {
        setTimeout(() => {
          void driver.transaction(async () => nested.run());
        }, 5);
      });
      await wait(30);

      expect(begin).toHaveBeenCalledTimes(2);
      expect(nested.seen[0].session).toBe(client);
    });
  });

  describe("MongoDbDriver", () => {
    const makeSession = (attempts = 1) => ({
      startTransaction: vi.fn().mockResolvedValue(undefined),
      commitTransaction: vi.fn().mockResolvedValue(undefined),
      abortTransaction: vi.fn().mockResolvedValue(undefined),
      endSession: vi.fn().mockResolvedValue(undefined),
      // Mimics withTransaction retrying the callback on a transient error
      withTransaction: vi.fn(async (cb: () => Promise<void>) => {
        for (let attempt = 1; attempt < attempts; attempt += 1) {
          await cb();
        }

        await cb();
      }),
    });

    const makeDriver = (session: ReturnType<typeof makeSession>) => {
      const driver = new MongoDbDriver({ database: "test", uri: "mongodb://localhost" });
      const internals = driver as unknown as Record<string, unknown>;

      internals.client = { startSession: () => session };
      internals.replicaSetChecked = true;

      return driver;
    };

    it("a timer armed in transaction() runs without the session after commit", async () => {
      const session = makeSession();
      const driver = makeDriver(session);
      const timer = probe();
      const inside = probe();

      await driver.transaction(async () => {
        setTimeout(timer.run, 5);
        inside.run();
      });
      await wait(20);

      expect(inside.seen[0]).toEqual({ session, active: true });
      expect(session.endSession).toHaveBeenCalled();
      expect(timer.seen).toEqual([{ session: undefined, active: false }]);
    });

    it("a timer armed in transaction() runs without the session after rollback", async () => {
      const driver = makeDriver(makeSession());
      const timer = probe();

      await expect(
        driver.transaction(async () => {
          setTimeout(timer.run, 5);
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      await wait(20);

      expect(timer.seen).toEqual([{ session: undefined, active: false }]);
    });

    it("ends the store of every retried attempt", async () => {
      const driver = makeDriver(makeSession(2));
      const timer = probe();

      await driver.transaction(async () => {
        setTimeout(timer.run, 5);
      });
      await wait(20);

      expect(timer.seen).toHaveLength(2);
      expect(timer.seen.every((entry) => entry.session === undefined && !entry.active)).toBe(true);
    });

    // enter() inside the async beginTransaction() only reaches work armed from
    // the driver's own continuation, so these tests capture the store it enters
    // and run a probe inside it, as a timer armed in that chain would.
    it.each(["commit", "rollback"] as const)(
      "the store entered by beginTransaction() stops handing out the session after %s",
      async (outcome) => {
        const session = makeSession();
        const driver = makeDriver(session);
        const enter = vi.spyOn(databaseTransactionContext, "enter");
        const timer = probe();

        const tx = await driver.beginTransaction();
        const store = enter.mock.calls[0][0];

        await databaseTransactionContext.run(store, async () => timer.run());
        await tx[outcome]();
        await databaseTransactionContext.run(store, async () => timer.run());

        expect(timer.seen).toEqual([
          { session, active: true },
          { session: undefined, active: false },
        ]);
      },
    );

    it("the store entered by beginTransaction() also ends when the commit fails", async () => {
      const session = makeSession();
      session.commitTransaction.mockRejectedValue(new Error("commit failed"));
      const driver = makeDriver(session);
      const enter = vi.spyOn(databaseTransactionContext, "enter");
      const timer = probe();

      const tx = await driver.beginTransaction();
      const store = enter.mock.calls[0][0];

      await expect(tx.commit()).rejects.toThrow("commit failed");
      await databaseTransactionContext.run(store, async () => timer.run());

      expect(timer.seen).toEqual([{ session: undefined, active: false }]);
    });
  });
});
