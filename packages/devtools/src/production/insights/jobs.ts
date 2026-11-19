import type {
  DevtoolsJobsReport,
  DevtoolsQueueInfo,
  DevtoolsScheduleInfo,
  DevtoolsScheduleRun,
} from "../contracts";
import { scrubErrorText } from "../capture/redact";
import type { DevtoolsJobsReader } from "./types";

/** The shape of a scheduler job this reader needs (duck-typed: the packages stay optional). */
type SchedulerJobLike = {
  name: string;
  cronExpression?: string | null;
  intervals?: { every?: { type?: string; value?: number } };
  isRunning?: boolean;
  lastRun?: { valueOf(): number } | null;
  nextRun?: { valueOf(): number } | null;
  /** Totals and run history (scheduler 5.61+). */
  stats?: {
    runs?: number;
    failures?: number;
    lastRunAt?: number | null;
    lastDurationMs?: number | null;
    lastError?: string | null;
  };
  history?: readonly DevtoolsScheduleRun[];
};

const RECENT_RUNS = 10;

/** Longest job error text the tab shows, the same cut as a request error. */
const JOB_ERROR_MAX = 500;

/** Where the jobs come from; replaced in specs. Each returns `null` when its package is absent. */
export type DevtoolsJobsLoaders = {
  scheduler(): Promise<readonly SchedulerJobLike[] | null>;
  queue(): Promise<DevtoolsQueueInfo[] | null>;
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

    if (!driver || typeof driver.running !== "function") return null;

    // Queues with a worker here, plus the queues registered jobs are dispatched to.
    const names = new Set(driver.running());
    const registered = queue?.registeredJobs as (() => unknown[]) | undefined;
    const queueOf = queue?.queueOf as ((job: unknown) => string) | undefined;

    for (const job of registered?.() ?? []) {
      if (queueOf) names.add(queueOf(job));
    }

    const queues: DevtoolsQueueInfo[] = [];

    for (const name of names) {
      if (typeof driver.counts !== "function") {
        queues.push({ name, counts: {}, countsAvailable: false });
        continue;
      }

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

/**
 * Copies the public fields only, so nothing else a scheduler adds leaks into the report. The error is scrubbed
 * like every other error text the monitor keeps (quoted values, emails and documents removed).
 */
function toRun(run: DevtoolsScheduleRun): DevtoolsScheduleRun {
  return {
    startedAt: run.startedAt,
    durationMs: run.durationMs,
    outcome: run.outcome,
    ...(run.error ? { error: scrubErrorText(run.error, JOB_ERROR_MAX) } : {}),
    ...(run.skipReason ? { skipReason: run.skipReason } : {}),
  };
}

function toSchedule(job: SchedulerJobLike): DevtoolsScheduleInfo {
  return {
    name: job.name,
    cron: job.cronExpression ?? null,
    interval: readableInterval(job),
    isRunning: job.isRunning === true,
    lastRunAt: job.stats?.lastRunAt ?? (job.lastRun ? Number(job.lastRun.valueOf()) : null),
    nextRunAt: job.nextRun ? Number(job.nextRun.valueOf()) : null,
    lastDurationMs: job.stats?.lastDurationMs ?? null,
    lastError: job.stats?.lastError ? scrubErrorText(job.stats.lastError, JOB_ERROR_MAX) : null,
    runs: job.stats?.runs ?? 0,
    failures: job.stats?.failures ?? 0,
    ...(job.history ? { recentRuns: job.history.slice(0, RECENT_RUNS).map(toRun) } : {}),
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
