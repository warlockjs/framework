import { log } from "@warlock.js/logger";
import { databaseTransactionContext } from "../context/database-transaction-context";

type AfterCommitCallback = () => void | Promise<void>;

function reportFailure(error: unknown): void {
  log.error("database", "afterCommit", `[cascade] afterCommit callback failed: ${error}`);
}

/**
 * Run a callback only once the current transaction has COMMITTED.
 *
 * Model events (`saved`, `created`, `updated`, `deleted`) fire INSIDE the
 * transaction, before COMMIT. Anything that must observe committed data
 * (cache invalidation, sitemap regeneration, webhooks) belongs here.
 *
 * - Inside a transaction: queued, run after the outermost COMMIT, in order,
 *   awaited one by one. Discarded on rollback or a failed COMMIT.
 * - Outside a transaction: run on the next microtask (not awaited by the caller).
 * - A callback that throws is logged; it never affects the transaction result
 *   or the remaining callbacks.
 * - Callbacks run after the transaction context has exited, so any DB work
 *   they do is outside the finished transaction.
 *
 * @example
 * Product.events().onSaved(() => afterCommit(() => regenerateSitemap()));
 */
export function afterCommit(fn: AfterCommitCallback): void {
  if (databaseTransactionContext.hasActiveTransaction()) {
    databaseTransactionContext.addAfterCommit(fn);
    return;
  }

  Promise.resolve().then(fn).catch(reportFailure);
}

/**
 * Run committed callbacks sequentially. Never throws.
 * Drivers call this after a successful COMMIT and after the context exited.
 */
export async function flushAfterCommit(callbacks: AfterCommitCallback[]): Promise<void> {
  for (const callback of callbacks) {
    try {
      await callback();
    } catch (error) {
      reportFailure(error);
    }
  }
}
