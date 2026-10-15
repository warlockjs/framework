import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { databaseTransactionContext } from "../../../src/context/database-transaction-context";
import { PostgresDriver } from "../../../src/drivers/postgres/postgres-driver";
import { afterCommit, flushAfterCommit } from "../../../src/transactions/after-commit";

/**
 * afterCommit() against PostgresDriver.transaction() with beginTransaction
 * mocked (same harness as transaction-nesting.test.ts). MongoDB's driver uses
 * the same flush helper; a mongo integration spec is pending.
 */
type WithBegin = { beginTransaction(options?: unknown): Promise<unknown> };

describe("afterCommit()", () => {
  let driver: PostgresDriver;
  let commit: ReturnType<typeof vi.fn>;
  let rollback: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    databaseTransactionContext.clear();
    driver = new PostgresDriver({ database: "test" });
    commit = vi.fn().mockResolvedValue(undefined);
    rollback = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(driver as unknown as WithBegin, "beginTransaction").mockResolvedValue({
      context: { id: "tx" },
      commit,
      rollback,
    });
  });

  afterEach(() => {
    databaseTransactionContext.clear();
    vi.restoreAllMocks();
  });

  it("(a) runs on a microtask outside a transaction", async () => {
    const fn = vi.fn();

    afterCommit(fn);
    expect(fn).not.toHaveBeenCalled();

    await Promise.resolve();
    await Promise.resolve();

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("(b) does not run before the callback returns; runs after commit", async () => {
    const calls: string[] = [];
    commit.mockImplementation(async () => {
      calls.push("commit");
    });

    await driver.transaction(async () => {
      afterCommit(() => {
        calls.push("hook");
      });
      calls.push("body-end");
    });

    expect(calls).toEqual(["body-end", "commit", "hook"]);
  });

  it("(c) never runs on rollback", async () => {
    const fn = vi.fn();

    await expect(
      driver.transaction(async () => {
        afterCommit(fn);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(rollback).toHaveBeenCalled();
    expect(fn).not.toHaveBeenCalled();
  });

  it("never runs when COMMIT fails", async () => {
    const fn = vi.fn();
    commit.mockRejectedValue(new Error("commit failed"));

    await expect(
      driver.transaction(async () => {
        afterCommit(fn);
      }),
    ).rejects.toThrow("commit failed");

    expect(fn).not.toHaveBeenCalled();
  });

  it("(d) nested transaction() is flushed once, by the outermost commit", async () => {
    const calls: string[] = [];
    commit.mockImplementation(async () => {
      calls.push("commit");
    });

    await driver.transaction(async () => {
      await driver.transaction(async () => {
        afterCommit(() => {
          calls.push("inner-hook");
        });
      });
      calls.push("after-inner");
    });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["after-inner", "commit", "inner-hook"]);
  });

  it("(e) a throwing callback does not change the result or stop later callbacks", async () => {
    const later = vi.fn();

    const result = await driver.transaction(async () => {
      afterCommit(() => {
        throw new Error("hook failed");
      });
      afterCommit(later);
      return "value";
    });

    expect(result).toBe("value");
    expect(later).toHaveBeenCalledTimes(1);
  });

  it("(f) preserves order, awaiting each callback sequentially", async () => {
    const order: number[] = [];

    await driver.transaction(async () => {
      afterCommit(async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        order.push(1);
      });
      afterCommit(() => {
        order.push(2);
      });
      afterCommit(() => {
        order.push(3);
      });
    });

    expect(order).toEqual([1, 2, 3]);
  });

  it("flushAfterCommit never throws", async () => {
    const ok = vi.fn();

    await expect(
      flushAfterCommit([
        () => {
          throw new Error("x");
        },
        ok,
      ]),
    ).resolves.toBeUndefined();
    expect(ok).toHaveBeenCalled();
  });

  it("context queue: add then take empties it", () => {
    databaseTransactionContext.setSession({ id: "s" });
    const fn = vi.fn();

    databaseTransactionContext.addAfterCommit(fn);

    expect(databaseTransactionContext.takeAfterCommit()).toEqual([fn]);
    expect(databaseTransactionContext.takeAfterCommit()).toEqual([]);
  });
});
