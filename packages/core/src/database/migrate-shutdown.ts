import { dataSourceRegistry, migrationRunner, withTimeout } from "@warlock.js/cascade";

/** Longest the process waits for locks and connections to close before it exits anyway. */
export const MIGRATE_SHUTDOWN_BUDGET_MS = 15_000;

let shutdownPromise: Promise<void> | undefined;

/**
 * Release the migration lock and close every data-source connection.
 *
 * `migrate` is a one-shot command that ends with `process.exit`, which skips
 * the driver's own cleanup: sessions are never ended on the server, the lock
 * document stays claimed until its TTL, and a transaction that was open stays
 * open until the server times it out. Closing the client ends every session it
 * opened, which also aborts any open transaction.
 *
 * Idempotent and never throws: it runs on the way out, where a second error
 * would only hide the first. Concurrent calls share one run.
 */
export function shutdownMigrateConnections(): Promise<void> {
  shutdownPromise ??= (async () => {
    try {
      await withTimeout(closeAll(), MIGRATE_SHUTDOWN_BUDGET_MS, () => "shutdown timed out");
    } catch {
      // Out of budget or a close failed: the exit that follows ends the sockets.
    }
  })();

  return shutdownPromise;
}

/** Forget a finished shutdown so the next command in this process can run its own. */
export function resetMigrateShutdown(): void {
  shutdownPromise = undefined;
}

async function closeAll(): Promise<void> {
  try {
    await migrationRunner.releaseActiveLocks();
  } catch {
    // The lock expires on its own; closing the connections matters more.
  }

  for (const dataSource of dataSourceRegistry.getAllDataSources()) {
    try {
      await dataSource.driver.disconnect();
    } catch {
      // Keep closing the others.
    }
  }
}

/**
 * Close connections on SIGINT / SIGTERM, then exit with the conventional
 * `128 + signal` code. Returns a function that removes the handlers.
 */
export function installMigrateInterruptHandlers(): () => void {
  const signals: Array<{ signal: NodeJS.Signals; code: number }> = [
    { signal: "SIGINT", code: 130 },
    { signal: "SIGTERM", code: 143 },
  ];

  const registered = signals.map(({ signal, code }) => {
    const handler = () => {
      void shutdownMigrateConnections().finally(() => process.exit(code));
    };

    process.once(signal, handler);

    return { signal, handler };
  });

  return () => {
    for (const { signal, handler } of registered) process.off(signal, handler);
  };
}
