import type { DevtoolsJobsReport, DevtoolsScheduleInfo } from "../contracts";
import type { DevtoolsJobsReader } from "./types";

/** The shape of a scheduler job this reader needs (duck-typed: the packages stay optional). */
type SchedulerJobLike = {
  name: string;
  cronExpression?: string | null;
  intervals?: { every?: { type?: string; value?: number } };
  isRunning?: boolean;
  lastRun?: { valueOf(): number } | null;
  nextRun?: { valueOf(): number } | null;
};

/** Where the jobs come from; replaced in specs. Each returns `null` when its package is absent. */
export type DevtoolsJobsLoaders = {
  scheduler(): Promise<readonly SchedulerJobLike[] | null>;
  queue(): Promise<{ name: string; counts: Record<string, number> }[] | null>;
};

const SCHEDULER_KEY = Symbol.for("warlock.scheduler.running");

/** Imports an optional package by name; `null` when it is not installed. */
async function importOptional(name: string): Promise<Record<string, unknown> | null> {
  try {
    return (await import(/* @vite-ignore */ name)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const defaultLoaders: DevtoolsJobsLoaders = {
  async scheduler() {
    if (!(await importOptional("@warlock.js/scheduler"))) return null;

    const running = (globalThis as Record<symbol, unknown>)[SCHEDULER_KEY] as
      | Iterable<{ list?: () => readonly SchedulerJobLike[] }>
      | undefined;
    const jobs: SchedulerJobLike[] = [];

    for (const scheduler of running ?? []) {
      if (typeof scheduler.list === "function") jobs.push(...scheduler.list());
    }

    return jobs;
  },

  async queue() {
    const queue = await importOptional("@warlock.js/queue");
    const current = queue?.currentQueueDriver as (() => unknown) | undefined;
    const driver = current?.() as
      | {
          running?: () => string[];
          counts?: (queue: string) => Promise<Record<string, number>>;
        }
      | undefined;

    if (!driver || typeof driver.counts !== "function" || typeof driver.running !== "function") {
      return null;
    }

    const queues: { name: string; counts: Record<string, number> }[] = [];

    for (const name of driver.running()) {
      queues.push({ name, counts: await driver.counts(name) });
    }

    return queues;
  },
};

function readableInterval(job: SchedulerJobLike): string | null {
  const every = job.intervals?.every;

  if (!every?.type) return null;

  const value = every.value ?? 1;
  const unit = every.type.replace(/s$/, "");

  return value === 1 ? `every ${unit}` : `every ${value} ${unit}s`;
}

function toSchedule(job: SchedulerJobLike): DevtoolsScheduleInfo {
  return {
    name: job.name,
    cron: job.cronExpression ?? null,
    interval: readableInterval(job),
    isRunning: job.isRunning === true,
    lastRunAt: job.lastRun ? Number(job.lastRun.valueOf()) : null,
    nextRunAt: job.nextRun ? Number(job.nextRun.valueOf()) : null,
    // The scheduler keeps no per-run history; these stay empty.
    lastDurationMs: null,
    lastError: null,
    runs: 0,
    failures: 0,
  };
}

/**
 * Reads the scheduler's jobs and the queue's counts when those packages are
 * installed. A part that is absent or fails reports `available: false` with
 * nothing else; the reader itself never throws.
 */
export function createJobsReader(loaders: Partial<DevtoolsJobsLoaders> = {}): DevtoolsJobsReader {
  const source = { ...defaultLoaders, ...loaders };

  return async () => {
    const report: DevtoolsJobsReport = {
      available: { scheduler: false, queue: false },
      schedules: [],
      queues: [],
    };

    try {
      const jobs = await source.scheduler();

      if (jobs) {
        report.available.scheduler = true;
        report.schedules = jobs.map(toSchedule);
      }
    } catch {
      report.available.scheduler = false;
      report.schedules = [];
    }

    try {
      const queues = await source.queue();

      if (queues) {
        report.available.queue = true;
        report.queues = queues;
      }
    } catch {
      report.available.queue = false;
      report.queues = [];
    }

    return report;
  };
}
