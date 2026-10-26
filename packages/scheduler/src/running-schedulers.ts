/**
 * Process-wide list of the schedulers that are currently ticking.
 *
 * A running scheduler keeps a timer armed, and an application that starts one
 * (usually from a module's boot code) rarely stops it by hand. The host process
 * (`@warlock.js/core`) reads this list when it shuts down and stops every
 * scheduler on it, so the process can exit.
 *
 * The list lives on `globalThis` under a registered symbol rather than in a
 * module, because the scheduler and the host can be loaded as separate copies
 * of their packages, and neither imports the other.
 */
export const RUNNING_SCHEDULERS_KEY = Symbol.for("warlock.scheduler.running");

/** What the host needs from a running scheduler. */
export type StoppableScheduler = {
  shutdown(timeout?: number): Promise<void>;
};

type SchedulerHost = { [RUNNING_SCHEDULERS_KEY]?: Set<StoppableScheduler> };

function runningSchedulers(): Set<StoppableScheduler> {
  const host = globalThis as SchedulerHost;

  host[RUNNING_SCHEDULERS_KEY] ??= new Set();

  return host[RUNNING_SCHEDULERS_KEY];
}

/** Record a scheduler that just started ticking. */
export function trackRunningScheduler(scheduler: StoppableScheduler): void {
  runningSchedulers().add(scheduler);
}

/** Forget a scheduler that stopped ticking. */
export function untrackRunningScheduler(scheduler: StoppableScheduler): void {
  runningSchedulers().delete(scheduler);
}
