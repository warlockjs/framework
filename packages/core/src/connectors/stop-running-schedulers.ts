import { log } from "@warlock.js/logger";

/**
 * Where `@warlock.js/scheduler` lists the schedulers that are ticking. Read by
 * symbol, not imported: the scheduler package is optional and core does not
 * depend on it.
 */
const RUNNING_SCHEDULERS_KEY = Symbol.for("warlock.scheduler.running");

type StoppableScheduler = { shutdown(timeout?: number): Promise<void> };

/**
 * Stop every scheduler that is still ticking, waiting up to `timeout` ms for the
 * jobs they are running.
 *
 * A started scheduler keeps a timer armed for as long as it runs. The
 * application starts it from a module and has no reason to stop it by hand, so
 * without this the timer outlives the connectors and a process that otherwise
 * finished (a Vitest main process after the HTTP test server stopped, a
 * one-shot command) cannot exit.
 *
 * Each scheduler is stopped on its own: one that rejects is logged and does not
 * keep the others running.
 */
export async function stopRunningSchedulers(timeout: number): Promise<void> {
  const running = (globalThis as { [RUNNING_SCHEDULERS_KEY]?: Set<StoppableScheduler> })[
    RUNNING_SCHEDULERS_KEY
  ];

  if (!running || running.size === 0) return;

  await Promise.all(
    [...running].map(async (scheduler) => {
      try {
        await scheduler.shutdown(timeout);
      } catch (error) {
        log.error("connectors", "shutdown", error as Error, { connector: "scheduler" });
      }
    }),
  );
}
