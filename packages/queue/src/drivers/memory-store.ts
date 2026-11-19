import type { JobState, QueueCounts } from "../types";
import {
  addToCounts,
  jsonCopy,
  type LocalJob,
  type LocalStore,
  type RetentionWindow,
} from "./local-store";

const READY_STATES: readonly JobState[] = ["waiting", "delayed", "prioritized"];

/**
 * In-process store. Reads copy only the jobs they return, and a transaction
 * records what it overwrites instead of cloning the whole store, so an idle
 * poll costs nothing however many finished jobs are kept.
 */
export class MemoryStore implements LocalStore {
  private jobs = new Map<string, LocalJob>();
  /** Previous value of every key written in the open transaction (`undefined`: it was absent). */
  private undo?: Map<string, LocalJob | undefined>;
  /** Taken before the first removal, so a rollback restores the original order too. */
  private snapshot?: Map<string, LocalJob>;
  /** Keys of each queue's jobs that can still become ready (not finished), so a poll skips kept history. */
  private pollable = new Map<string, Set<string>>();
  /** Insertion rank of every key, so ties on priority resolve to the oldest job. */
  private ranks = new Map<string, number>();
  private nextRank = 0;

  public transaction<T>(run: () => T): T {
    // Nested calls join the outer transaction.
    if (this.undo) return run();
    this.undo = new Map();
    try {
      return run();
    } catch (error) {
      this.rollback();
      throw error;
    } finally {
      this.undo = undefined;
      this.snapshot = undefined;
    }
  }
  private rollback(): void {
    const undo = this.undo;
    if (!undo) return;
    const jobs = this.snapshot ?? this.jobs;
    for (const [key, previous] of undo) {
      if (previous === undefined) jobs.delete(key);
      else jobs.set(key, previous);
    }
    this.jobs = jobs;
    this.reindex();
  }
  /** Rebuild the poll index and ranks from the stored jobs (after a rollback). */
  private reindex(): void {
    this.pollable.clear();
    this.ranks.clear();
    this.nextRank = 0;
    for (const [key, job] of this.jobs) {
      this.ranks.set(key, this.nextRank++);
      this.track(key, job);
    }
  }
  private track(key: string, job: LocalJob): void {
    const keys = this.pollable.get(job.queue);
    const isPollable = job.state === "active" || READY_STATES.includes(job.state);
    if (isPollable) {
      if (keys) keys.add(key);
      else this.pollable.set(job.queue, new Set([key]));
    } else keys?.delete(key);
  }
  private remember(key: string): void {
    if (this.undo && !this.undo.has(key)) this.undo.set(key, this.jobs.get(key));
  }
  private key(queue: string, id: string): string {
    return JSON.stringify([queue, id]);
  }
  public get(queue: string, id: string): LocalJob | undefined {
    return jsonCopy(this.jobs.get(this.key(queue, id)));
  }
  public list(queue: string, state?: JobState): LocalJob[] {
    return [...this.jobs.values()]
      .filter((job) => job.queue === queue && (!state || job.state === state))
      .map(jsonCopy);
  }
  public counts(queue: string): QueueCounts {
    const counts: QueueCounts = { waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0 };
    for (const job of this.jobs.values()) {
      if (job.queue === queue) addToCounts(counts, job.state);
    }
    return counts;
  }
  public ready(queue: string, now: number): LocalJob | undefined {
    let candidate: LocalJob | undefined;
    let candidateRank = 0;
    for (const key of this.pollable.get(queue) ?? []) {
      const job = this.jobs.get(key)!;
      const eligible =
        (job.state === "active" && job.leaseUntil <= now) ||
        (READY_STATES.includes(job.state) && job.readyAt <= now);
      if (!eligible) continue;
      const rank = this.ranks.get(key)!;
      if (
        !candidate ||
        job.priority < candidate.priority ||
        (job.priority === candidate.priority && rank < candidateRank)
      ) {
        candidate = job;
        candidateRank = rank;
      }
    }
    return candidate === undefined ? undefined : jsonCopy(candidate);
  }
  public put(job: LocalJob): void {
    const key = this.key(job.queue, job.id);
    this.remember(key);
    const stored = jsonCopy(job);
    this.jobs.set(key, stored);
    if (!this.ranks.has(key)) this.ranks.set(key, this.nextRank++);
    this.track(key, stored);
  }
  public remove(queue: string, id: string): void {
    const key = this.key(queue, id);
    if (!this.jobs.has(key)) return;
    this.remember(key);
    if (this.undo && !this.snapshot) this.snapshot = new Map(this.jobs);
    this.jobs.delete(key);
    this.ranks.delete(key);
    this.pollable.get(queue)?.delete(key);
  }
  public prune(queue: string, state: "completed" | "failed", keep: RetentionWindow): void {
    const finished: LocalJob[] = [];
    for (const job of this.jobs.values()) {
      if (job.queue === queue && job.state === state) finished.push(job);
    }
    // Newest first: by finish time, then by most recent insertion.
    const newest = finished.reverse().sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
    newest.forEach((job, index) => {
      const expired = keep.before !== undefined && (job.finishedAt ?? 0) < keep.before;
      const overflow = keep.count !== undefined && index >= keep.count;
      if (expired || overflow) this.remove(job.queue, job.id);
    });
  }
  public close(): void {
    this.jobs.clear();
    this.pollable.clear();
    this.ranks.clear();
  }
}
