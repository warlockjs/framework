import type {
  ScopedBudgetReserveInput,
  ScopedBudgetReserveResult,
  ScopedBudgetStore,
} from "./scoped-budget-store.type";

type Ledger = Map<string, number>;

/**
 * Windows kept per scope key and unit. The newest two cover a request that
 * reserves just before a window rolls over and commits or refunds just
 * after; older windows can no longer change a decision and are dropped.
 */
const KEPT_WINDOWS = 2;

/** Entry counts of a memory store's internal maps, for specs. */
type MemoryScopedBudgetStoreSizes = { queues: number; ledger: number };

/** Size readers of every memory store, for specs; never part of the store surface. */
const sizeReaders = new WeakMap<ScopedBudgetStore, () => MemoryScopedBudgetStoreSizes>();

/**
 * Read the internal entry counts of a store built by
 * {@link memoryScopedBudgetStore}. Internal: used by specs to check that
 * idle keys and expired windows are released.
 */
export function memoryScopedBudgetStoreSizes(
  store: ScopedBudgetStore,
): MemoryScopedBudgetStoreSizes | undefined {
  return sizeReaders.get(store)?.();
}

/** Create an in-process scoped-budget store for tests and single-node development. */
export function memoryScopedBudgetStore(): ScopedBudgetStore {
  const ledger: Ledger = new Map();
  const queues = new Map<string, Promise<void>>();
  const windows = new Map<string, number[]>();

  function ledgerKey(input: ScopedBudgetReserveInput): string {
    return `${input.key}:${input.windowStart}:${input.unit}`;
  }

  /**
   * Record that `input`'s window is in use and drop the ledger entries of
   * windows older than the newest {@link KEPT_WINDOWS} for its scope key and
   * unit. Synchronous, so it runs inside the caller's atomic section.
   */
  function trackWindow(input: ScopedBudgetReserveInput): void {
    const scopeKey = `${input.key}:${input.unit}`;
    const kept = windows.get(scopeKey) ?? [];

    if (!kept.includes(input.windowStart)) {
      kept.push(input.windowStart);
      kept.sort((left, right) => left - right);
    }

    while (kept.length > KEPT_WINDOWS) {
      const expired = kept.shift() as number;

      ledger.delete(`${input.key}:${expired}:${input.unit}`);
    }

    windows.set(scopeKey, kept);
  }

  async function atomically<T>(
    input: ScopedBudgetReserveInput,
    action: () => T | Promise<T>,
  ): Promise<T> {
    const key = ledgerKey(input);
    const previous = queues.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The stored tail is what a later caller waits on, and what identifies
    // this call as the last one queued for the key.
    const tail = previous.then(() => current);
    queues.set(key, tail);
    await previous;

    try {
      const result = await action();

      trackWindow(input);

      return result;
    } finally {
      release();
      if (queues.get(key) === tail) {
        queues.delete(key);
      }
    }
  }

  const store: ScopedBudgetStore = {
    async reserve(input): Promise<ScopedBudgetReserveResult> {
      const key = ledgerKey(input);
      return atomically(input, () => {
        const used = ledger.get(key) ?? 0;
        const next = used + input.amount;

        if (next > input.limit) {
          return { allowed: false, used: next };
        }

        ledger.set(key, next);
        return { allowed: true, used: next };
      });
    },
    async commit(input, actual): Promise<ScopedBudgetReserveResult> {
      const key = ledgerKey(input);
      return atomically(input, () => {
        const used = ledger.get(key) ?? 0;
        const next = used - input.amount + actual;

        if (next > input.limit) {
          return { allowed: false, used: next };
        }

        ledger.set(key, Math.max(0, next));
        return { allowed: true, used: Math.max(0, next) };
      });
    },
    async refund(input, amount = input.amount): Promise<number> {
      const key = ledgerKey(input);
      return atomically(input, () => {
        const next = Math.max(0, (ledger.get(key) ?? 0) - amount);
        ledger.set(key, next);
        return next;
      });
    },
  };

  sizeReaders.set(store, () => ({ queues: queues.size, ledger: ledger.size }));

  return store;
}
