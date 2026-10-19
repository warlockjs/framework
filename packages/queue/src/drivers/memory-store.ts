import type { JobState } from "../types";
import { jsonCopy, type LocalJob, type LocalStore } from "./local-store";

export class MemoryStore implements LocalStore {
  private jobs = new Map<string, LocalJob>();
  public transaction<T>(run: () => T): T {
    const before = new Map(this.jobs);
    try {
      return run();
    } catch (error) {
      this.jobs = before;
      throw error;
    }
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
  public ready(queue: string, now: number): LocalJob | undefined {
    let candidate: LocalJob | undefined;
    for (const job of this.list(queue)) {
      const eligible =
        (job.state === "active" && job.leaseUntil <= now) ||
        (["waiting", "delayed", "prioritized"].includes(job.state) && job.readyAt <= now);
      if (eligible && (!candidate || job.priority < candidate.priority)) candidate = job;
    }
    return candidate;
  }
  public put(job: LocalJob): void {
    this.jobs.set(this.key(job.queue, job.id), jsonCopy(job));
  }
  public remove(queue: string, id: string): void {
    this.jobs.delete(this.key(queue, id));
  }
  public close(): void {
    this.jobs.clear();
  }
}
