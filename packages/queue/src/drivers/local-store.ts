import type { ResolvedJobOptions } from "../job-options";
import type { JobProgress, JobState, QueueCounts } from "../types";

export type LocalJob = {
  id: string;
  queue: string;
  name: string;
  data: unknown;
  options: ResolvedJobOptions;
  state: JobState;
  createdAt: number;
  readyAt: number;
  attemptsMade: number;
  priority: number;
  progress: JobProgress;
  logs: string[];
  stacktrace: string[];
  failedReason?: string;
  result?: unknown;
  finishedAt?: number;
  token?: string;
  leaseUntil: number;
};

/** What `prune` keeps: jobs finished at or after `before`, at most `count` of them. */
export type RetentionWindow = { count?: number; before?: number };

/** Synchronous transactions contain no user code or await points. */
export interface LocalStore {
  transaction<T>(run: () => T): T;
  get(queue: string, id: string): LocalJob | undefined;
  list(queue: string, state?: JobState): LocalJob[];
  /** Earliest eligible job, including active jobs with an expired lease. */
  ready(queue: string, now: number): LocalJob | undefined;
  /** Number of jobs per state in one queue, without copying them. */
  counts(queue: string): QueueCounts;
  put(job: LocalJob): void;
  remove(queue: string, id: string): void;
  /**
   * Delete the finished jobs of one state that fall outside a retention: those
   * finished before `before`, and those past the newest `count` (newest by
   * finish time, then by insertion).
   */
  prune(queue: string, state: "completed" | "failed", keep: RetentionWindow): void;
  close(): void;
}

/** Folds a job state into the public counts (`prioritized` counts as waiting). */
export function addToCounts(counts: QueueCounts, state: JobState, amount = 1): void {
  const key = state === "prioritized" ? "waiting" : state;
  if (
    key === "waiting" ||
    key === "active" ||
    key === "delayed" ||
    key === "failed" ||
    key === "completed"
  )
    counts[key] = (counts[key] ?? 0) + amount;
}

/** Match JSON transport on every backend, without sharing mutable objects. */
export function jsonCopy<T>(value: T): T {
  return (JSON.parse(JSON.stringify({ value })) as { value: T }).value;
}
